import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { SPA_ROUTING_CODE, WebStack } from '../lib/web-stack.ts';
import { testApp } from './test-app.ts';

// Web hosting (S2-04). Expected values are written out literally, so changing a constant in
// the code also fails here.

const SITE = fileURLToPath(new URL('./fixtures/site', import.meta.url));

describe('Web stack', () => {
  const stack = new WebStack(testApp(), 'Web', {
    host: 'dev.cv.ikiwii.com',
    config: { environment: 'dev', apiUrl: 'https://api.dev.cv.ikiwii.com' },
    siteDirectory: SITE,
  });
  const template = Template.fromStack(stack);
  const parameterId = (prefix: string) =>
    Object.keys(template.findParameters('*')).find((id) => id.startsWith(prefix));
  const zoneIdParameter = parameterId('SsmParameterValuecvtailordnszoneid');
  const certificateArnParameter = parameterId('SsmParameterValuecvtailordnscertificatearn');

  test('reads the zone ID and certificate ARN from SSM at deploy time, not from exports', () => {
    template.hasParameter(zoneIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/dns/zone-id',
    });
    template.hasParameter(certificateArnParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/dns/certificate-arn',
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  test('keeps the bucket private, encrypted, and reachable only over TLS', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  test('lets only this distribution read the bucket, through origin access control', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Action: 's3:GetObject',
            Condition: { StringEquals: { 'AWS:SourceArn': Match.anyValue() } },
          }),
        ]),
      },
    });
  });

  test('serves only the host, over HTTPS, from every edge location', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: ['dev.cv.ikiwii.com'],
        PriceClass: 'PriceClass_All',
        HttpVersion: 'http2and3',
        ViewerCertificate: {
          AcmCertificateArn: { Ref: certificateArnParameter },
          MinimumProtocolVersion: 'TLSv1.2_2021',
          SslSupportMethod: 'sni-only',
        },
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: [{ EventType: 'viewer-request', FunctionARN: Match.anyValue() }],
        },
      },
    });
  });

  test('sends HSTS, the content security policy, and the other security headers', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          StrictTransportSecurity: {
            AccessControlMaxAgeSec: 63072000,
            IncludeSubdomains: true,
            Override: true,
          },
          ContentSecurityPolicy: {
            ContentSecurityPolicy:
              "default-src 'self'; connect-src 'self' https://api.dev.cv.ikiwii.com; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
            Override: true,
          },
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
        },
      },
    });
  });

  test('runs the routing function on the 2.0 runtime', () => {
    template.hasResourceProperties('AWS::CloudFront::Function', {
      FunctionCode: SPA_ROUTING_CODE,
      FunctionConfig: { Runtime: 'cloudfront-js-2.0' },
      AutoPublish: true,
    });
  });

  test('points the host at the distribution over IPv4 and IPv6', () => {
    for (const Type of ['A', 'AAAA']) {
      template.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: 'dev.cv.ikiwii.com.',
        Type,
        HostedZoneId: { Ref: zoneIdParameter },
        AliasTarget: { DNSName: { 'Fn::GetAtt': [Match.anyValue(), 'DomainName'] } },
      });
    }
  });

  test('uploads the hashed assets with a one-year cache, and keeps old ones', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 2);
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      DestinationBucketKeyPrefix: 'assets/',
      Prune: false,
      SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' },
    });
  });

  test('uploads index.html and config.json after the assets, uncached, then clears the CDN cache', () => {
    const [assetsDeployment] = Object.keys(
      template.findResources('Custom::CDKBucketDeployment', {
        Properties: { DestinationBucketKeyPrefix: 'assets/' },
      }),
    );
    template.hasResource('Custom::CDKBucketDeployment', {
      Properties: Match.objectLike({
        Prune: true,
        Exclude: ['assets/*'],
        SystemMetadata: { 'cache-control': 'no-cache' },
        DistributionPaths: ['/*'],
      }),
      DependsOn: Match.arrayWith([assetsDeployment]),
    });
  });
});

describe('SPA routing function', () => {
  // Runs the exact code CloudFront runs, in a fresh JavaScript context.
  type Handler = (event: { request: { uri: string } }) => { uri: string };
  const handler = runInNewContext(`${SPA_ROUTING_CODE}\nhandler;`) as Handler;

  test.each([
    ['/', '/index.html'],
    ['/profile', '/index.html'],
    ['/applications/123', '/index.html'],
    ['/assets/index-a1b2c3.js', '/assets/index-a1b2c3.js'],
    ['/config.json', '/config.json'],
  ])('%s → %s', (uri, expected) => {
    expect(handler({ request: { uri } }).uri).toBe(expected);
  });
});

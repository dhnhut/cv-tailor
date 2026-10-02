import { join } from 'node:path';
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { WebConfig } from '@cv-tailor/contracts';
import { CERTIFICATE_ARN_PARAMETER } from './certificate-stack.ts';
import { ZONE_ID_PARAMETER } from './zone-stack.ts';

// Runs at the edge before the cache lookup. A path whose last segment has no dot is an app
// route, so it gets index.html and React shows the page. Files (/assets/*.js, /config.json)
// pass through, so a missing file gets S3's 403 instead of the app. App routes must never end
// in a segment with a dot.
export const SPA_ROUTING_CODE = `function handler(event) {
  const request = event.request;
  const lastSegment = request.uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

// Everything comes from this origin only. base-uri, frame-ancestors, and form-action don't fall
// back to default-src, so they're set too. S2-09, S2-10, and Turnstile add their origins here.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export interface WebStackProps extends StackProps {
  readonly host: string;
  readonly config: WebConfig; // written to /config.json
  readonly siteDirectory: string; // the web app's build output
}

// The web app at https://<host> (S2-04): a private S3 bucket that only this CloudFront
// distribution can read, through origin access control.
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    const { host, config, siteDirectory, ...stackProps } = props;
    super(scope, id, stackProps);

    // Holds only build output, which every deploy uploads again, so it goes with the stack.
    const bucket = new Bucket(this, 'Site', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const spaRouting = new CloudFrontFunction(this, 'SpaRouting', {
      code: FunctionCode.fromInline(SPA_ROUTING_CODE),
      runtime: FunctionRuntime.JS_2_0,
      comment: 'Serves index.html for app routes (S2-04)',
    });

    const securityHeaders = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: `Security headers for ${host} (S2-04)`,
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: host,
      domainNames: [host],
      certificate: Certificate.fromCertificateArn(
        this,
        'Certificate',
        StringParameter.valueForStringParameter(this, CERTIFICATE_ARN_PARAMETER),
      ),
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_ALL, // includes the edge locations in Australia and New Zealand
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          { function: spaRouting, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      zoneName: host,
      hostedZoneId: StringParameter.valueForStringParameter(this, ZONE_ID_PARAMETER),
    });
    const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
    new ARecord(this, 'AliasIpv4', { zone, target });
    new AaaaRecord(this, 'AliasIpv6', { zone, target });

    // 1. Hashed files: a new name for every change, so browsers keep them for a year. Old ones
    //    stay (prune: false), so a tab opened before a deploy can still load its chunks.
    const assets = new BucketDeployment(this, 'DeployAssets', {
      sources: [Source.asset(join(siteDirectory, 'assets'))],
      destinationBucket: bucket,
      destinationKeyPrefix: 'assets/',
      cacheControl: [
        CacheControl.setPublic(),
        CacheControl.maxAge(Duration.days(365)),
        CacheControl.immutable(),
      ],
      prune: false,
    });

    // 2. index.html and config.json: browsers check for a new version on every load. Uploaded
    //    after the assets, so index.html never points at a file that isn't there yet.
    const entry = new BucketDeployment(this, 'DeployEntry', {
      sources: [
        Source.asset(siteDirectory, { exclude: ['assets', 'config.json'] }),
        Source.jsonData('config.json', config),
      ],
      destinationBucket: bucket,
      exclude: ['assets/*'], // keeps this deployment's prune away from the hashed files
      cacheControl: [CacheControl.noCache()],
      distribution,
      distributionPaths: ['/*'],
    });
    entry.node.addDependency(assets);
  }
}

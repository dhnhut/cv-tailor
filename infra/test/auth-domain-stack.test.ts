import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { AuthDomainStack } from '../lib/auth-domain-stack.ts';
import { testApp } from './test-app.ts';

// The sign-in pages (S2-05, ADR-0008, ADR-0009). Expected values are written out literally, so
// changing a constant in the code also fails here.

describe('Auth domain stack', () => {
  const stack = new AuthDomainStack(testApp(), 'AuthDomain', { host: 'dev.cv.ikiwii.com' });
  const template = Template.fromStack(stack);
  const parameterId = (prefix: string) =>
    Object.keys(template.findParameters('*')).find((id) => id.startsWith(prefix));
  const userPoolIdParameter = parameterId('SsmParameterValuecvtailorauthuserpoolid');
  const clientIdParameter = parameterId('SsmParameterValuecvtailorauthwebclientid');
  const certificateArnParameter = parameterId('SsmParameterValuecvtailordnscertificatearn');
  const zoneIdParameter = parameterId('SsmParameterValuecvtailordnszoneid');
  const [domainId] = Object.keys(template.findResources('AWS::Cognito::UserPoolDomain'));

  test('reads its IDs from SSM at deploy time, not from CloudFormation exports', () => {
    template.hasParameter(userPoolIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/auth/user-pool-id',
    });
    template.hasParameter(clientIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/auth/web-client-id',
    });
    template.hasParameter(certificateArnParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/dns/certificate-arn',
    });
    template.hasParameter(zoneIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/dns/zone-id',
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  test('serves managed login, not the classic hosted UI, at auth.<host>', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    template.hasResourceProperties(
      'AWS::Cognito::UserPoolDomain',
      Match.objectEquals({
        Domain: 'auth.dev.cv.ikiwii.com',
        UserPoolId: { Ref: userPoolIdParameter },
        CustomDomainConfig: { CertificateArn: { Ref: certificateArnParameter } },
        ManagedLoginVersion: 2,
      }),
    );
  });

  test('gives the web client the default Cognito style, once the domain exists', () => {
    template.hasResource('AWS::Cognito::ManagedLoginBranding', {
      Properties: Match.objectEquals({
        UserPoolId: { Ref: userPoolIdParameter },
        ClientId: { Ref: clientIdParameter },
        UseCognitoProvidedValues: true,
      }),
      DependsOn: Match.arrayWith([domainId]),
    });
  });

  test('points auth.<host> at the CloudFront distribution that Cognito runs for the domain', () => {
    template.resourceCountIs('AWS::Route53::RecordSet', 1);
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'auth.dev.cv.ikiwii.com.',
      Type: 'A',
      HostedZoneId: { Ref: zoneIdParameter },
      AliasTarget: { DNSName: { 'Fn::GetAtt': [domainId, 'CloudFrontDistribution'] } },
    });
  });
});

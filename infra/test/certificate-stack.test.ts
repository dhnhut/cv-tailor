import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { CertificateStack } from '../lib/certificate-stack.ts';
import { testApp } from './test-app.ts';

// ACM certificate (S2-03, ADR-0008). Expected values are written out literally, so changing
// a constant in the code also fails here.

describe('Certificate stack', () => {
  const stack = new CertificateStack(testApp(), 'Certificate', {
    zoneName: 'dev.cv.ikiwii.com',
  });
  const template = Template.fromStack(stack);
  const zoneIdParameter = Object.keys(template.findParameters('*')).find((id) =>
    id.startsWith('SsmParameterValuecvtailordnszoneid'),
  );
  const [certificateId] = Object.keys(
    template.findResources('AWS::CertificateManager::Certificate'),
  );

  test('reads the zone ID from SSM at deploy time, not from a CloudFormation export', () => {
    expect(zoneIdParameter).toBeDefined();
    template.hasParameter(zoneIdParameter!, {
      Type: 'AWS::SSM::Parameter::Value<String>',
      Default: '/cv-tailor/dns/zone-id',
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('Fn::ImportValue');
  });

  // The host and its wildcard share one ACM validation record, so one validation option
  // covers both names.
  test('requests one certificate for the host and its wildcard, validated through DNS in the zone', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    template.hasResourceProperties(
      'AWS::CertificateManager::Certificate',
      Match.objectEquals({
        DomainName: 'dev.cv.ikiwii.com',
        SubjectAlternativeNames: ['*.dev.cv.ikiwii.com'],
        ValidationMethod: 'DNS',
        DomainValidationOptions: [
          { DomainName: 'dev.cv.ikiwii.com', HostedZoneId: { Ref: zoneIdParameter } },
        ],
        Tags: [{ Key: 'Name', Value: 'dev.cv.ikiwii.com' }],
      }),
    );
  });

  test('publishes the certificate ARN in SSM, where the workload stage reads it', () => {
    template.resourceCountIs('AWS::SSM::Parameter', 1);
    template.hasResourceProperties(
      'AWS::SSM::Parameter',
      Match.objectEquals({
        Name: '/cv-tailor/dns/certificate-arn',
        Description: 'ACM certificate for dev.cv.ikiwii.com and *.dev.cv.ikiwii.com (S2-03)',
        Type: 'String',
        Value: { Ref: certificateId },
      }),
    );
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });
});

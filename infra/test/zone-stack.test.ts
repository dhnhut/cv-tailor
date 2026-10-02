import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import { ZoneStack } from '../lib/zone-stack.ts';
import { testApp } from './test-app.ts';

// Hosted zone (S2-03, ADR-0008). Expected values are written out literally, so changing
// a constant in the code also fails here.

const NAME_SERVERS = [
  'ns-1.awsdns-01.org',
  'ns-2.awsdns-02.co.uk',
  'ns-3.awsdns-03.com',
  'ns-4.awsdns-04.net',
];

describe('Zone stack with a child zone delegation', () => {
  const stack = new ZoneStack(testApp(), 'Zone', {
    zoneName: 'cv.ikiwii.com',
    delegations: [{ zoneName: 'dev.cv.ikiwii.com', nameServers: NAME_SERVERS }],
  });
  const template = Template.fromStack(stack);
  const [zoneId] = Object.keys(template.findResources('AWS::Route53::HostedZone'));

  test('creates one public hosted zone, retained when the stack is deleted or the zone replaced', () => {
    template.resourceCountIs('AWS::Route53::HostedZone', 1);
    template.hasResource('AWS::Route53::HostedZone', {
      Properties: Match.objectEquals({ Name: 'cv.ikiwii.com.' }),
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('delegates the child zone to its name servers with a one-hour TTL', () => {
    template.resourceCountIs('AWS::Route53::RecordSet', 1);
    template.hasResourceProperties(
      'AWS::Route53::RecordSet',
      Match.objectEquals({
        HostedZoneId: { Ref: zoneId },
        Name: 'dev.cv.ikiwii.com.',
        Type: 'NS',
        TTL: '3600',
        ResourceRecords: NAME_SERVERS,
      }),
    );
  });

  test('publishes the zone ID in SSM, where other stacks read it', () => {
    template.resourceCountIs('AWS::SSM::Parameter', 1);
    template.hasResourceProperties(
      'AWS::SSM::Parameter',
      Match.objectEquals({
        Name: '/cv-tailor/dns/zone-id',
        Description: 'Hosted zone ID of cv.ikiwii.com (S2-03)',
        Type: 'String',
        Value: { Ref: zoneId },
      }),
    );
  });

  test('outputs the name servers for the registrar or the parent zone', () => {
    template.hasOutput('NameServers', {
      Value: { 'Fn::Join': [',', { 'Fn::GetAtt': [zoneId, 'NameServers'] }] },
    });
  });

  test('has termination protection', () => {
    expect(stack.terminationProtection).toBe(true);
  });
});

test('a zone without delegations has no records of its own', () => {
  const template = Template.fromStack(
    new ZoneStack(testApp(), 'Zone', { zoneName: 'dev.cv.ikiwii.com', delegations: [] }),
  );

  template.resourceCountIs('AWS::Route53::RecordSet', 0);
});

// A delegation for a name outside the zone would never be used by resolvers, so it fails
// at synth time instead of silently doing nothing.
test.each(['cv.ikiwii.com', 'other.example.com', 'devcv.ikiwii.com'])(
  'refuses to delegate %s from dev.cv.ikiwii.com',
  (child) => {
    expect(
      () =>
        new ZoneStack(testApp(), 'Zone', {
          zoneName: 'dev.cv.ikiwii.com',
          delegations: [{ zoneName: child, nameServers: NAME_SERVERS }],
        }),
    ).toThrow(`${child} can't be delegated from dev.cv.ikiwii.com: it isn't a subdomain of it.`);
  },
);

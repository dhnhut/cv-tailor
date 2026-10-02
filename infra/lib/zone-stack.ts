import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { NsRecord, PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { ZoneDelegation } from '../config/environments.ts';

// Other stacks read the zone ID from here at deploy time, so no CloudFormation export
// ties them to this stack (S2-03).
export const ZONE_ID_PARAMETER = '/cv-tailor/dns/zone-id';

// A mistake in a child zone's name servers is fixed by redeploying this stack. A short TTL
// lets the fix reach resolvers within an hour.
const DELEGATION_TTL = Duration.hours(1);

export interface ZoneStackProps extends StackProps {
  readonly zoneName: string;
  readonly delegations: readonly ZoneDelegation[];
}

// One environment's public hosted zone (S2-03, ADR-0008). The zone is retained if the stack
// is deleted: a new zone gets new name servers, and the delegation above it would break.
export class ZoneStack extends Stack {
  constructor(scope: Construct, id: string, props: ZoneStackProps) {
    const { zoneName, delegations, ...stackProps } = props;
    super(scope, id, { terminationProtection: true, ...stackProps });

    const zone = new PublicHostedZone(this, 'Zone', { zoneName });
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    for (const { zoneName: child, nameServers } of delegations) {
      if (!child.endsWith(`.${zoneName}`)) {
        throw new Error(
          `${child} can't be delegated from ${zoneName}: it isn't a subdomain of it.`,
        );
      }
      new NsRecord(this, `Delegation-${child}`, {
        zone,
        recordName: child,
        values: [...nameServers],
        ttl: DELEGATION_TTL,
      });
    }

    new StringParameter(this, 'ZoneIdParameter', {
      parameterName: ZONE_ID_PARAMETER,
      description: `Hosted zone ID of ${zoneName} (S2-03)`,
      stringValue: zone.hostedZoneId,
    });

    // Copied by hand once: to the registrar for cv.ikiwii.com, or into the parent zone's
    // delegation for a child zone (deploy runbook, step 3).
    new CfnOutput(this, 'NameServers', {
      value: Fn.join(',', zone.hostedZoneNameServers ?? []),
    });
  }
}

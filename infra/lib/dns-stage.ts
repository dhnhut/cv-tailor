import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { DnsConfig, EnvironmentConfig } from '../config/environments.ts';
import { CertificateStack } from './certificate-stack.ts';
import { ZoneStack } from './zone-stack.ts';

export interface DnsStageProps extends StageProps {
  readonly config: EnvironmentConfig;
  readonly dns: DnsConfig;
}

// DNS for one account (S2-03, ADR-0008). Kept out of CvTailorStage so that app deploys
// (`cdk deploy '<env>/*'`) never change a zone or wait on certificate validation.
// Deployed from a laptop, in the order in the deploy runbook.
export class DnsStage extends Stage {
  constructor(scope: Construct, id: string, props: DnsStageProps) {
    const { config, dns, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: { account: config.account, region: config.region },
    });

    const zone = new ZoneStack(this, 'Zone', {
      zoneName: config.host,
      delegations: dns.delegations,
    });

    if (dns.certificate) {
      const certificate = new CertificateStack(this, 'Certificate', { zoneName: config.host });
      certificate.addStackDependency(
        zone,
        'reads the zone ID parameter that the zone stack writes',
      );
    }
  }
}

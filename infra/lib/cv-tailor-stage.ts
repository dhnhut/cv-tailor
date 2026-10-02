import { fileURLToPath } from 'node:url';
import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { WebStack } from './web-stack.ts';

// The web app's build output. It must exist before synth: `pnpm run check` builds it first
// (infra depends on @cv-tailor/web), and deploy.yml builds it before `cdk deploy`.
const WEB_DIST = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));

export interface CvTailorStageProps extends StageProps {
  readonly config: EnvironmentConfig;
}

// One Stage per environment. Stacks inside inherit the Stage's account and region,
// so a stack can't be synthesised without an explicit account (ADR-0004).
// The workload reads its zone and certificate from the <env>-dns stage, so that stage
// (with its certificate) is deployed first. Only dev has both today.
export class CvTailorStage extends Stage {
  constructor(scope: Construct, id: string, props: CvTailorStageProps) {
    const { config, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: { account: config.account, region: config.region },
    });

    new WebStack(this, 'Web', {
      host: config.host,
      config: { environment: config.name },
      siteDirectory: WEB_DIST,
    });
  }
}

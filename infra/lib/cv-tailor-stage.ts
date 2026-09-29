import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { HelloStack } from './hello-stack.ts';

export interface CvTailorStageProps extends StageProps {
  readonly config: EnvironmentConfig;
}

// One Stage per environment. Stacks inside inherit the Stage's account and region,
// so a stack can't be synthesised without an explicit account (ADR-0004).
export class CvTailorStage extends Stage {
  constructor(scope: Construct, id: string, props: CvTailorStageProps) {
    const { config, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: { account: config.account, region: config.region },
    });

    new HelloStack(this, 'CvTailor-Hello');
  }
}

import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { BudgetStack } from './budget-stack.ts';

export interface BaselineStageProps extends StageProps {
  readonly config: EnvironmentConfig;
}

// Account-level controls for one account (S1-09). Kept out of CvTailorStage so that
// app deploys (`cdk deploy '<env>/*'`) never change them. Deployed from a laptop.
export class BaselineStage extends Stage {
  constructor(scope: Construct, id: string, props: BaselineStageProps) {
    const { config, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: { account: config.account, region: config.region },
    });

    new BudgetStack(this, 'Budget', {
      budgetName: `cv-tailor-${config.name}-monthly`,
      monthlyLimitUsd: config.monthlyBudgetUsd,
      alertEmail: config.alertEmail,
    });
  }
}

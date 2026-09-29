import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { GITHUB_REPOSITORY, type EnvironmentConfig } from '../config/environments.ts';
import { OidcStack } from './oidc-stack.ts';

export interface AccessStageProps extends StageProps {
  readonly config: EnvironmentConfig;
}

// CI access for one account (S1-07). Kept out of CvTailorStage so that CI's
// `cdk deploy '<env>/*'` never changes the role CI signs in with.
export class AccessStage extends Stage {
  constructor(scope: Construct, id: string, props: AccessStageProps) {
    const { config, ...stageProps } = props;
    super(scope, id, {
      ...stageProps,
      env: { account: config.account, region: config.region },
    });

    new OidcStack(this, 'GithubOidc', { repository: GITHUB_REPOSITORY, environment: config.name });
  }
}

import { fileURLToPath } from 'node:url';
import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { AuthDomainStack } from './auth-domain-stack.ts';
import { AuthStack } from './auth-stack.ts';
import { WebStack } from './web-stack.ts';
import { DataStack } from './data-stack.ts';

// The web app's build output. It must exist before synth: `pnpm run check` builds it first
// (infra depends on @cv-tailor/web), and deploy.yml builds it before `cdk deploy`.
const WEB_DIST = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));

// The pre sign-up trigger's bundle (S2-07). Built the same way: `pnpm run check` builds it first
// (infra depends on @cv-tailor/api), and deploy.yml builds it before `cdk deploy`.
const PRE_SIGN_UP_DIST = fileURLToPath(new URL('../../apps/api/dist/pre-sign-up', import.meta.url));

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

    new DataStack(this, 'Data', { tableName: `cv-tailor-${config.name}-data` });

    const web = new WebStack(this, 'Web', {
      host: config.host,
      config: { environment: config.name },
      siteDirectory: WEB_DIST,
    });

    const auth = new AuthStack(this, 'Auth', {
      userPoolName: `cv-tailor-${config.name}-users`,
      webOrigins: config.webOrigins,
      googleClientId: config.googleClientId,
      preSignUpDirectory: PRE_SIGN_UP_DIST,
    });

    // CDK can't see a dependency through SSM, so both are declared (ADR-0008, S2-05).
    const authDomain = new AuthDomainStack(this, 'AuthDomain', { host: config.host });
    authDomain.addStackDependency(auth, 'reads the pool and client IDs that the auth stack writes');
    authDomain.addStackDependency(web, `Cognito needs ${config.host} to resolve first`);
  }
}

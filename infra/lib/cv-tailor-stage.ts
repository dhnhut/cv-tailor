import { fileURLToPath } from 'node:url';
import { Stage, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { WebConfig } from '@cv-tailor/contracts';
import type { EnvironmentConfig } from '../config/environments.ts';
import { ApiStack } from './api-stack.ts';
import { AuthDomainStack } from './auth-domain-stack.ts';
import { AuthStack } from './auth-stack.ts';
import { DataStack, dataTableName } from './data-stack.ts';
import { documentsBucketName, KnowledgeBaseStack } from './knowledge-base-stack.ts';
import { WebStack, type WebConfigAtSynth } from './web-stack.ts';

// The web app's build output. It must exist before synth: `pnpm run check` builds it first
// (infra depends on @cv-tailor/web), and deploy.yml builds it before `cdk deploy`.
const WEB_DIST = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));

// The API's Lambda bundles: the pre sign-up trigger (S2-07), GET /me (S2-09), and the document
// API (S3-07). Built the same way: `pnpm run check` builds them first (infra depends on
// @cv-tailor/api), and deploy.yml builds them before `cdk deploy`.
const apiDist = (name: string) =>
  fileURLToPath(new URL(`../../apps/api/dist/${name}`, import.meta.url));
const PRE_SIGN_UP_DIST = apiDist('pre-sign-up');
const ME_DIST = apiDist('me');
const CREATE_DOCUMENT_DIST = apiDist('create-document');
const LIST_DOCUMENTS_DIST = apiDist('list-documents');
const DELETE_DOCUMENT_DIST = apiDist('delete-document');

// The parts of /config.json known at synth (S2-04, S2-09, S2-10). Checked against the contract
// here, so a wrong value fails `cdk synth` instead of the web app at start-up. The pool and client
// IDs come from Cognito at deploy time (WebStack), so the web app checks those when it starts.
const WebConfigAtSynth = WebConfig.omit({ userPoolId: true, webClientId: true });

export const webConfigFor = (config: EnvironmentConfig): WebConfigAtSynth =>
  WebConfigAtSynth.parse({
    environment: config.name,
    apiUrl: `https://api.${config.host}`,
    authUrl: `https://auth.${config.host}`,
  });

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

    const tableName = dataTableName(config.name);
    const data = new DataStack(this, 'Data', { tableName });

    // The API finds the bucket by its fixed name, as it finds the table. S3-10 (agents) reads the
    // knowledge base IDs from SSM.
    const bucketName = documentsBucketName(config.name, config.account);
    const knowledgeBase = new KnowledgeBaseStack(this, 'KnowledgeBase', {
      bucketName,
      knowledgeBaseName: `cv-tailor-${config.name}-kb`,
      webOrigin: `https://${config.host}`,
    });

    const web = new WebStack(this, 'Web', {
      host: config.host,
      config: webConfigFor(config),
      siteDirectory: WEB_DIST,
    });

    const auth = new AuthStack(this, 'Auth', {
      userPoolName: `cv-tailor-${config.name}-users`,
      webOrigins: config.webOrigins,
      googleClientId: config.googleClientId,
      preSignUpDirectory: PRE_SIGN_UP_DIST,
    });

    // config.json holds the pool and client IDs, which WebStack reads from SSM. CDK can't see that
    // (S2-10). No cycle: AuthStack doesn't depend on WebStack. AuthDomain depends on both.
    web.addStackDependency(
      auth,
      'config.json holds the pool and client IDs that the auth stack writes',
    );

    // CDK can't see a dependency through SSM, so both are declared (ADR-0008, S2-05).
    const authDomain = new AuthDomainStack(this, 'AuthDomain', { host: config.host });
    authDomain.addStackDependency(auth, 'reads the pool and client IDs that the auth stack writes');
    authDomain.addStackDependency(web, `Cognito needs ${config.host} to resolve first`);

    // The API reads the pool ID from SSM, and its Lambda finds the table by name. CDK can't see
    // either, so both are declared, and a new environment's first deploy runs in order (S2-09).
    // Only the web app's own origin: localhost isn't allowed, even in dev (S2-09).
    const api = new ApiStack(this, 'Api', {
      host: config.host,
      tableName,
      webOrigin: `https://${config.host}`,
      meDirectory: ME_DIST,
      documentsBucketName: bucketName,
      createDocumentDirectory: CREATE_DOCUMENT_DIST,
      listDocumentsDirectory: LIST_DOCUMENTS_DIST,
      deleteDocumentDirectory: DELETE_DOCUMENT_DIST,
    });
    api.addStackDependency(auth, 'reads the user pool ID that the auth stack writes');
    api.addStackDependency(data, 'its Lambdas read and write the data table');
    api.addStackDependency(knowledgeBase, 'its document Lambdas use the documents bucket');
  }
}

import { Stage } from 'aws-cdk-lib';
import { describe, expect, test } from 'vitest';
import { REGION, loadEnvironments, type EnvironmentName } from '../config/environments.ts';
import { createApp } from '../lib/app.ts';
import { webConfigFor } from '../lib/cv-tailor-stage.ts';
import { TEST_APP_PROPS, TEST_ENV } from './test-app.ts';

// Every stage (workload, access, baseline, and DNS) synthesises and pins us-east-1
// (S1-06, S1-07, S1-09, S2-03, ADR-0002 verification step 2).
// The app comes from createApp(), the same wiring bin/infra.ts uses, so a stage dropped
// from the real app fails here.
// IDs come from a fake env, never process.env, so a developer's infra/.env doesn't matter.

const CONFIGS = loadEnvironments(TEST_ENV);
const app = createApp(TEST_ENV, TEST_APP_PROPS);

const REGION_PATTERN = /\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/g;

// Written out literally, so a stage or stack added, dropped, or renamed fails here.
// stag has no DNS stage until the release path (slice R).
const EXPECTED: Record<EnvironmentName, { stages: string[]; stacks: string[] }> = {
  dev: {
    stages: ['dev', 'dev-access', 'dev-baseline', 'dev-dns'],
    stacks: [
      'dev-Auth',
      'dev-Data',
      'dev-KnowledgeBase',
      'dev-Api',
      'dev-Web',
      'dev-AuthDomain',
      'dev-access-GithubOidc',
      'dev-baseline-Budget',
      'dev-baseline-KillSwitch',
      'dev-dns-Zone',
      'dev-dns-Certificate',
    ],
  },
  stag: {
    stages: ['stag', 'stag-access', 'stag-baseline'],
    stacks: [
      'stag-Auth',
      'stag-Data',
      'stag-KnowledgeBase',
      'stag-Api',
      'stag-Web',
      'stag-AuthDomain',
      'stag-access-GithubOidc',
      'stag-baseline-Budget',
      'stag-baseline-KillSwitch',
    ],
  },
  prod: {
    stages: ['prod', 'prod-access', 'prod-baseline', 'prod-dns'],
    stacks: [
      'prod-Auth',
      'prod-Data',
      'prod-KnowledgeBase',
      'prod-Api',
      'prod-Web',
      'prod-AuthDomain',
      'prod-access-GithubOidc',
      'prod-baseline-Budget',
      'prod-baseline-KillSwitch',
      'prod-dns-Zone',
    ],
  },
};

// findChild throws if the stage is missing.
const synthStage = (id: string) => {
  const stage = app.node.findChild(id);
  if (!Stage.isStage(stage)) throw new Error(`${id} is not a Stage`);
  return stage.synth();
};

test('the app holds exactly the expected stages of each environment', () => {
  expect(app.node.children.map((child) => child.node.id)).toEqual(
    CONFIGS.flatMap((config) => EXPECTED[config.name].stages),
  );
});

describe.each(CONFIGS)('stages for $name', (config) => {
  const stacks = EXPECTED[config.name].stages
    .map(synthStage)
    .flatMap((assembly) => assembly.stacks);

  test('synthesises the expected stacks', () => {
    expect(stacks.map((s) => s.stackName)).toEqual(EXPECTED[config.name].stacks);
  });

  test('pins every stack to its own account and us-east-1', () => {
    for (const stack of stacks) {
      expect(stack.environment.account).toBe(config.account);
      expect(stack.environment.region).toBe(REGION);
    }
  });

  test('templates mention no region other than us-east-1', () => {
    for (const stack of stacks) {
      const regions = JSON.stringify(stack.template).match(REGION_PATTERN) ?? [];
      expect(regions.filter((r) => r !== REGION)).toEqual([]);
    }
  });
});

// The certificate stack reads the zone ID from SSM, which CDK can't see as a dependency,
// so `cdk deploy 'dev-dns/*'` relies on the explicit one.
test('the dev certificate stack deploys after the dev zone stack', () => {
  const { stacks } = synthStage('dev-dns');
  const zone = stacks.find((s) => s.stackName === 'dev-dns-Zone');
  const certificate = stacks.find((s) => s.stackName === 'dev-dns-Certificate');

  expect(certificate?.dependencies.map((d) => d.id)).toContain(zone?.id);
});

// AuthDomain reads Auth's SSM parameters, which CDK can't see, and Cognito creates the custom
// domain only when <host> (in Web) resolves (ADR-0008).
test.each(CONFIGS)('the $name sign-in domain deploys after its auth and web stacks', (config) => {
  const { stacks } = synthStage(config.name);
  const stack = (name: string) => stacks.find((s) => s.stackName === `${config.name}-${name}`);

  expect(stack('AuthDomain')?.dependencies.map((d) => d.id)).toEqual(
    expect.arrayContaining([stack('Auth')?.id, stack('Web')?.id]),
  );
});

// ADR-0009 §5: Cognito sends sign-in codes to localhost only in dev.
test.each(CONFIGS)('only the dev app client accepts localhost callbacks ($name)', (config) => {
  const auth = synthStage(config.name).stacks.find((s) => s.stackName === `${config.name}-Auth`);

  expect(JSON.stringify(auth?.template).includes('http://localhost')).toBe(config.name === 'dev');
});

// S2-06: only dev has a Google client so far (GOOGLE_CLIENT_ID in config/environments.ts).
test.each(CONFIGS)('only the dev user pool offers Google sign-in ($name)', (config) => {
  const auth = synthStage(config.name).stacks.find((s) => s.stackName === `${config.name}-Auth`);

  expect(JSON.stringify(auth?.template).includes('AWS::Cognito::UserPoolIdentityProvider')).toBe(
    config.name === 'dev',
  );
});

// ADR-0006 verification step 1: exactly one DynamoDB table in each environment, across all of its
// stages, on demand, with TTL, and with PITR and deletion protection on its one us-east-1 replica.
// Counting across every stage catches a second table added by mistake in any stack.
const TABLE_TYPES = ['AWS::DynamoDB::Table', 'AWS::DynamoDB::GlobalTable'];

interface CfnResource {
  readonly Type: string;
  readonly Properties: Record<string, unknown>;
}

test.each(CONFIGS)('the $name environment has exactly one data table (ADR-0006)', (config) => {
  const tables = EXPECTED[config.name].stages
    .map(synthStage)
    .flatMap((assembly) => assembly.stacks)
    .flatMap((stack) =>
      Object.values((stack.template as { Resources: Record<string, CfnResource> }).Resources)
        .filter((resource) => TABLE_TYPES.includes(resource.Type))
        .map(({ Type, Properties }) => ({
          stack: stack.stackName,
          type: Type,
          name: Properties.TableName,
          billing: Properties.BillingMode,
          ttl: Properties.TimeToLiveSpecification,
          replicas: Properties.Replicas,
        })),
    );

  expect(tables).toEqual([
    {
      stack: `${config.name}-Data`,
      type: 'AWS::DynamoDB::GlobalTable',
      name: `cv-tailor-${config.name}-data`,
      billing: 'PAY_PER_REQUEST',
      ttl: { AttributeName: 'expiresAt', Enabled: true },
      replicas: [
        {
          Region: 'us-east-1',
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
          DeletionProtectionEnabled: true,
        },
      ],
    },
  ]);
});

// The API reads the pool ID from SSM and finds the table by name, which CDK can't see (S2-09).
test.each(CONFIGS)('the $name API deploys after its auth and data stacks', (config) => {
  const { stacks } = synthStage(config.name);
  const stack = (name: string) => stacks.find((s) => s.stackName === `${config.name}-${name}`);

  expect(stack('Api')?.dependencies.map((d) => d.id)).toEqual(
    expect.arrayContaining([stack('Auth')?.id, stack('Data')?.id]),
  );
});

// S2-09: CORS allows the deployed web app only. localhost signs in to dev (ADR-0009 §5), but
// can't call the API directly; S2-10 gives the dev server a proxy instead.
test.each(CONFIGS)('the $name API allows only its own web origin', (config) => {
  const api = synthStage(config.name).stacks.find((s) => s.stackName === `${config.name}-Api`);
  const template = JSON.stringify(api?.template);

  expect(template).toContain(`'https://${config.host}'`);
  expect(template).not.toContain('localhost');
});

// Written out literally: each environment's web app calls its own API (ADR-0008 names).
const API_URL: Record<EnvironmentName, string> = {
  dev: 'https://api.dev.cv.ikiwii.com',
  stag: 'https://api.stag.cv.ikiwii.com',
  prod: 'https://api.cv.ikiwii.com',
};

// Written out literally: each environment's web app calls its own API and sign-in pages (ADR-0008).
const AUTH_URL: Record<EnvironmentName, string> = {
  dev: 'https://auth.dev.cv.ikiwii.com',
  stag: 'https://auth.stag.cv.ikiwii.com',
  prod: 'https://auth.cv.ikiwii.com',
};

test.each(CONFIGS)('the $name web app is told its own API and sign-in URLs', (config) => {
  expect(webConfigFor(config)).toEqual({
    environment: config.name,
    apiUrl: API_URL[config.name],
    authUrl: AUTH_URL[config.name],
  });
});

// S2-10: config.json holds the pool and client IDs, which the web stack reads from SSM.
test.each(CONFIGS)('the $name web app deploys after its auth stack', (config) => {
  const { stacks } = synthStage(config.name);
  const stack = (name: string) => stacks.find((s) => s.stackName === `${config.name}-${name}`);

  expect(stack('Web')?.dependencies.map((d) => d.id)).toContain(stack('Auth')?.id);
});

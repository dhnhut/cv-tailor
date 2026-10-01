import { Stage } from 'aws-cdk-lib';
import { describe, expect, test } from 'vitest';
import { REGION, loadEnvironments } from '../config/environments.ts';
import { createApp } from '../lib/app.ts';
import { TEST_APP_PROPS, TEST_ENV } from './test-app.ts';

// Every stage (workload, access, and baseline) synthesises and pins us-east-1
// (S1-06, S1-07, S1-09, ADR-0002 verification step 2).
// The app comes from createApp(), the same wiring bin/infra.ts uses, so a stage dropped
// from the real app fails here.
// IDs come from a fake env, never process.env, so a developer's infra/.env doesn't matter.

const CONFIGS = loadEnvironments(TEST_ENV);
const app = createApp(TEST_ENV, TEST_APP_PROPS);

const REGION_PATTERN = /\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/g;

const stageIds = (name: string): string[] => [name, `${name}-access`, `${name}-baseline`];

// findChild throws if the stage is missing.
const synthStage = (id: string) => {
  const stage = app.node.findChild(id);
  if (!Stage.isStage(stage)) throw new Error(`${id} is not a Stage`);
  return stage.synth();
};

test('the app holds exactly the workload, access, and baseline stage of each environment', () => {
  expect(app.node.children.map((child) => child.node.id)).toEqual(
    CONFIGS.flatMap((config) => stageIds(config.name)),
  );
});

describe.each(CONFIGS)('stages for $name', (config) => {
  const stacks = stageIds(config.name)
    .map(synthStage)
    .flatMap((assembly) => assembly.stacks);

  test('synthesises the hello, GitHub OIDC, and budget stacks', () => {
    expect(stacks.map((s) => s.stackName)).toEqual([
      `${config.name}-CvTailor-Hello`,
      `${config.name}-access-GithubOidc`,
      `${config.name}-baseline-Budget`,
    ]);
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

import { describe, expect, test } from 'vitest';
import { REGION, loadEnvironments } from '../config/environments.ts';
import { AccessStage } from '../lib/access-stage.ts';
import { CvTailorStage } from '../lib/cv-tailor-stage.ts';
import { testApp } from './test-app.ts';

// Every stage (workload and access) synthesises and pins us-east-1
// (S1-06, S1-07, ADR-0002 verification step 2).
// IDs come from a fake env, never process.env, so a developer's infra/.env doesn't matter.

const CONFIGS = loadEnvironments({
  CVT_DEV_ACCOUNT_ID: '111111111111',
  CVT_STAG_ACCOUNT_ID: '222222222222',
  CVT_PROD_ACCOUNT_ID: '333333333333',
});

const REGION_PATTERN = /\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/g;

describe.each(CONFIGS)('stages for $name', (config) => {
  const app = testApp();
  const stacks = [
    new CvTailorStage(app, config.name, { config }).synth(),
    new AccessStage(app, `${config.name}-access`, { config }).synth(),
  ].flatMap((assembly) => assembly.stacks);

  test('synthesises the hello and GitHub OIDC stacks', () => {
    expect(stacks.map((s) => s.stackName)).toEqual([
      `${config.name}-CvTailor-Hello`,
      `${config.name}-access-GithubOidc`,
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

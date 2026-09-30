import { describe, expect, test } from 'vitest';
import { REGION, loadEnvironments } from '../config/environments.ts';
import { AccessStage } from '../lib/access-stage.ts';
import { BaselineStage } from '../lib/baseline-stage.ts';
import { CvTailorStage } from '../lib/cv-tailor-stage.ts';
import { testApp, TEST_ENV } from './test-app.ts';

// Every stage (workload, access, and baseline) synthesises and pins us-east-1
// (S1-06, S1-07, S1-09, ADR-0002 verification step 2).
// IDs come from a fake env, never process.env, so a developer's infra/.env doesn't matter.

const CONFIGS = loadEnvironments(TEST_ENV);

const REGION_PATTERN = /\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/g;

describe.each(CONFIGS)('stages for $name', (config) => {
  const app = testApp();
  const stacks = [
    new CvTailorStage(app, config.name, { config }).synth(),
    new AccessStage(app, `${config.name}-access`, { config }).synth(),
    new BaselineStage(app, `${config.name}-baseline`, { config }).synth(),
  ].flatMap((assembly) => assembly.stacks);

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

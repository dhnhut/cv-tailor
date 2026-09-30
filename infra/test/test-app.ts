import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')) as {
  context: Record<string, unknown>;
};

// Tests match `cdk synth`: the feature flags from cdk.json, plus the CDKMetadata
// resource the CLI adds by default. Vitest doesn't use the CLI, so a bare
// `new App()` has neither.
export const testApp = (): App => new App({ context, analyticsReporting: true });

// Fake settings for loadEnvironments(), so a developer's infra/.env never affects tests.
export const TEST_ENV = {
  CVT_DEV_ACCOUNT_ID: '111111111111',
  CVT_STAG_ACCOUNT_ID: '222222222222',
  CVT_PROD_ACCOUNT_ID: '333333333333',
  CVT_ALERT_EMAIL: 'alerts@example.com',
};

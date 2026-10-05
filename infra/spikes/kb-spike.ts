import { App } from 'aws-cdk-lib';
import { loadEnvironments } from '../config/environments.ts';
import { KB_SPIKE_STACK_NAME, KbSpikeStack } from './kb-spike-stack.ts';

// S2-12 spike app, dev only. From the repo root:
//   pnpm --filter infra exec cdk --app 'node --env-file-if-exists=.env spikes/kb-spike.ts' deploy --profile cvt-dev
// loadEnvironments() reads process.env by default, as createApp() does for bin/infra.ts.
const dev = loadEnvironments().find((config) => config.name === 'dev');
if (!dev) throw new Error('dev is not configured');

const app = new App();
new KbSpikeStack(app, KB_SPIKE_STACK_NAME, {
  env: { account: dev.account, region: dev.region },
  description: 'S2-12 spike: managed knowledge base ACL isolation. Delete after the spike.',
});

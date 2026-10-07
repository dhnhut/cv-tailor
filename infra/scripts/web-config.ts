// Builds the web app's /config.json from the workload stack's outputs (S3-15, ADR-0013 §7), and
// checks it against the WebConfig contract before anything is uploaded. This keeps the check the
// CDK app ran at synth (S2-04, S2-10): a wrong value fails the deploy, not the web app at start-up.
//
//   scripts/tofu.sh dev workload output -json | node scripts/web-config.ts > config.json

import { readFileSync } from 'node:fs';
import { WebConfig } from '@cv-tailor/contracts';

// The shape of `tofu output -json`: each output's value, with its type and whether it's sensitive.
type TofuOutputs = Record<string, { value: unknown }>;

export function webConfigFrom(outputs: TofuOutputs): WebConfig {
  const value = (name: string): unknown => {
    const output = outputs[name];
    if (output === undefined) {
      throw new Error(`The workload stack has no "${name}" output. Apply it first.`);
    }
    return output.value;
  };

  return WebConfig.parse({
    environment: value('environment'),
    apiUrl: value('api_url'),
    authUrl: value('auth_url'),
    userPoolId: value('user_pool_id'),
    webClientId: value('web_client_id'),
  });
}

// `tofu output -json` text in, config.json text out.
export function main(tofuOutputJson: string): string {
  return `${JSON.stringify(webConfigFrom(JSON.parse(tofuOutputJson) as TofuOutputs), null, 2)}\n`;
}

// Runs only when Node runs this file as a script, in a child process that coverage can't see.
// test/web-config.test.ts runs it that way.
/* v8 ignore start */
if (import.meta.main) {
  process.stdout.write(main(readFileSync(0, 'utf8')));
}
/* v8 ignore stop */

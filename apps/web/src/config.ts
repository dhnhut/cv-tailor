import { WebConfig } from '@cv-tailor/contracts';

// Reads this environment's settings from /config.json, which CDK writes at deploy time (S2-04).
// The same build then runs in every environment. Throws if the file is missing or malformed.
export async function loadConfig(): Promise<WebConfig> {
  const response = await fetch('/config.json');
  if (!response.ok) {
    throw new Error(`Couldn't load /config.json: HTTP ${response.status}`);
  }
  return WebConfig.parse(await response.json());
}

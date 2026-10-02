import * as z from 'zod';

// The web app's settings for one environment. CDK writes them to /config.json at deploy time,
// and the web app reads them before it renders (S2-04). Not registered in `contracts`: only
// TypeScript reads this file, so no JSON Schema or Pydantic model is generated for it.
export const WebConfig = z
  .strictObject({
    environment: z.enum(['dev', 'stag', 'prod']).describe('The environment the app runs in.'),
  })
  .describe('Settings the web app reads from /config.json.');
export type WebConfig = z.infer<typeof WebConfig>;

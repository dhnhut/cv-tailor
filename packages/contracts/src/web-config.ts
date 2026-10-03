import * as z from 'zod';

// The web app's settings for one environment. CDK writes them to /config.json at deploy time,
// and the web app reads them before it renders (S2-04). Not registered in `contracts`: only
// TypeScript reads this file, so no JSON Schema or Pydantic model is generated for it.
export const WebConfig = z
  .strictObject({
    environment: z.enum(['dev', 'stag', 'prod']).describe('The environment the app runs in.'),
    // An origin only: the web app resolves paths such as /me against it, which would drop a
    // base path, and the content security policy allows only its origin (S2-09). Zod runs the
    // refinement even when the url check fails, so it checks that the value parses first.
    apiUrl: z
      .url({ protocol: /^https$/ })
      .refine(
        (value) => URL.canParse(value) && new URL(value).origin === value,
        'Must be an origin, with no path',
      )
      .describe('The API origin, https://api.<host>, with no path or trailing slash.'),
  })
  .describe('Settings the web app reads from /config.json.');
export type WebConfig = z.infer<typeof WebConfig>;

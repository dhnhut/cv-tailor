import * as z from 'zod';

// An https origin with no path: the web app resolves paths against it, and the CSP allows only
// the origin (S2-09). Zod runs the refinement even when the url check fails, so it checks that the
// value parses first.
const httpsOrigin = z
  .url({ protocol: /^https$/ })
  .refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    'Must be an origin, with no path',
  );

// The web app's settings for one environment. CDK writes them to /config.json at deploy time,
// and the web app reads them before it renders (S2-04). Not registered in `contracts`: only
// TypeScript reads this file, so no JSON Schema or Pydantic model is generated for it.
export const WebConfig = z
  .strictObject({
    environment: z.enum(['dev', 'stag', 'prod']).describe('The environment the app runs in.'),
    apiUrl: httpsOrigin.describe('The API origin, https://api.<host>.'),
    authUrl: httpsOrigin.describe('The sign-in origin, https://auth.<host>.'),
    // Cognito's documented formats. The pool ID starts with its region, which the issuer URL needs.
    userPoolId: z
      .string()
      .regex(/^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/)
      .describe('The user pool ID, for example us-east-1_AbC123.'),
    webClientId: z
      .string()
      .regex(/^[\w+]{1,128}$/)
      .describe("The web app's client ID in the user pool."),
  })
  .describe('Settings the web app reads from /config.json.');

export type WebConfig = z.infer<typeof WebConfig>;

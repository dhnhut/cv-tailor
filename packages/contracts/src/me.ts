import * as z from 'zod';

// GET /me (S2-09, ADR-0009 §6). No email address: access tokens don't carry it (SAFE-04).
// The web app shows the email from the ID token instead. Not registered: only TypeScript reads it.
export const MeResponse = z
  .strictObject({
    sub: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      .describe("The caller's Cognito sub, a lowercase UUID."),
    isAdmin: z.boolean().describe('True when the caller is in the admin group.'),
  })
  .describe('Who the signed-in caller is.');
export type MeResponse = z.infer<typeof MeResponse>;

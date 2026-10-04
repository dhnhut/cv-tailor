import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';

// Cognito wraps a pre sign-up refusal as "PreSignUp failed with error <message>." and sends it to
// the callback as error_description (ADR-0009 §2).
const PREFIX = 'PreSignUp failed with error ';
const KNOWN = new Set(Object.values(PRE_SIGN_UP_MESSAGES).map((text) => `${PREFIX}${text}.`));

export const GENERIC_SIGN_IN_ERROR = "Sign-in didn't work. Please try again.";

// What the callback page shows for a failed sign-in, or null when the URL has no error. Only the
// trigger's own messages are shown, so a crafted link can't put its own text on the page.
export function signInErrorMessage(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has('error')) return null;
  const description = params.get('error_description') ?? '';
  return KNOWN.has(description) ? description.slice(PREFIX.length) : GENERIC_SIGN_IN_ERROR;
}

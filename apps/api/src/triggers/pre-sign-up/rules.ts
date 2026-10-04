// Account-linking rules for the pre sign-up trigger (S2-07, ADR-0009 §2). Pure functions with no
// AWS calls, so each ADR case is a plain unit test. handler.ts carries out what they decide.
import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';

// The identity provider's name in the user pool. Cognito compares it case-sensitively.
export const GOOGLE_PROVIDER = 'Google';

// Gmail usernames are letters, digits, and dots. Only Gmail addresses are trusted at launch
// (ADR-0009 §2). The strict pattern also keeps the address safe inside a ListUsers filter string.
const GMAIL = /^[a-z0-9.]+@gmail\.com$/;

export interface GoogleIdentity {
  readonly sub: string; // Google's sub, which the link uses (not the email address)
  readonly email: string; // lowercased
}

export interface LocalUser {
  readonly username: string; // Cognito's own username (a UUID), not the email address
  readonly status: string; // Cognito's UserStatus
  readonly emailVerified: boolean;
  readonly linkedGoogleSubs: readonly string[]; // from the `identities` attribute
}

type RefusedCase = 6 | 7 | 10 | 'other';

export type Decision =
  | { readonly action: 'allow'; readonly adrCase: 1 | 8 }
  | { readonly action: 'refuse'; readonly adrCase: RefusedCase; readonly message: string }
  | {
      readonly action: 'link';
      readonly adrCase: 3;
      readonly username: string;
      readonly alreadyLinked: boolean;
    }
  | {
      readonly action: 'set-password-and-link';
      readonly adrCase: 10;
      readonly username: string;
      readonly alreadyLinked: boolean;
    }
  | { readonly action: 'create-and-link'; readonly adrCase: 4 }
  | {
      readonly action: 'delete-create-and-link';
      readonly adrCase: 5;
      readonly unconfirmedUsername: string;
    };

const refuse = (adrCase: RefusedCase, message: string): Decision => ({
  action: 'refuse',
  adrCase,
  message,
});

// Step A: does Google vouch for this identity? On a federated first sign-in, userName is
// "<provider>_<provider's sub>", for example "google_1234". Cognito sets the prefix, not the
// user, so it's compared without case: the pool stores usernames in lowercase.
export function readGoogleIdentity(
  userName: string,
  attributes: Readonly<Record<string, string>>,
): GoogleIdentity | Decision {
  const separator = userName.indexOf('_');
  const provider = userName.slice(0, separator).toLowerCase();
  const sub = userName.slice(separator + 1);
  // Only Google is trusted for linking. Another provider needs its own rule in ADR-0009 first.
  if (separator < 1 || provider !== GOOGLE_PROVIDER.toLowerCase() || sub === '') {
    return refuse('other', PRE_SIGN_UP_MESSAGES.failed);
  }

  // Case 6: Google vouches only for Gmail addresses that it has verified.
  const email = (attributes.email ?? '').toLowerCase();
  if (attributes.email_verified !== 'true' || !GMAIL.test(email)) {
    return refuse(6, PRE_SIGN_UP_MESSAGES.googleNotTrusted);
  }
  return { sub, email };
}

// Step B: what to do, given the local users with this email address. cognito.ts has already left
// out Google profiles that were never linked (status EXTERNAL_PROVIDER).
export function decide(identity: GoogleIdentity, users: readonly LocalUser[]): Decision {
  const [user, ...others] = users;
  if (!user) return { action: 'create-and-link', adrCase: 4 };
  // Can't happen: the email address is the username. Refuse rather than guess.
  if (others.length > 0) return refuse('other', PRE_SIGN_UP_MESSAGES.failed);

  // A retried trigger may find the link already made.
  const alreadyLinked = user.linkedGoogleSubs.includes(identity.sub);
  switch (user.status) {
    case 'UNCONFIRMED':
      // Case 5, the takeover case: never link. Whoever signed up never proved they own the address.
      return { action: 'delete-create-and-link', adrCase: 5, unconfirmedUsername: user.username };
    case 'CONFIRMED':
      return user.emailVerified
        ? { action: 'link', adrCase: 3, username: user.username, alreadyLinked }
        : refuse(7, PRE_SIGN_UP_MESSAGES.useYourPassword);
    case 'FORCE_CHANGE_PASSWORD':
      // Case 10: created by an admin, or by a case 4 that stopped before setting the password.
      return user.emailVerified
        ? { action: 'set-password-and-link', adrCase: 10, username: user.username, alreadyLinked }
        : refuse(10, PRE_SIGN_UP_MESSAGES.useYourPassword);
    default:
      // RESET_REQUIRED, ARCHIVED, COMPROMISED, UNKNOWN: no rule, so refuse.
      return refuse('other', PRE_SIGN_UP_MESSAGES.failed);
  }
}

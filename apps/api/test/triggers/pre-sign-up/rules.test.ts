import { describe, expect, test } from 'vitest';
import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';
import {
  decide,
  type GoogleIdentity,
  hdStatus,
  type LocalUser,
  readGoogleIdentity,
} from '../../../src/triggers/pre-sign-up/rules.ts';

// The account-linking rules (S2-07, ADR-0009 §2). Cases 1 and 8 are decided by trigger source in
// handler.ts. Cases 2 and 9 never reach the trigger, so they're checked live (google-sign-in
// runbook §4).

const GOOGLE_SUB = '109876543210987654321';
const VERIFIED_GMAIL = { email: 'alice@gmail.com', email_verified: 'true' };
const identity: GoogleIdentity = { sub: GOOGLE_SUB, email: 'alice@gmail.com' };

const localUser = (overrides: Partial<LocalUser> = {}): LocalUser => ({
  username: 'local-user-uuid',
  status: 'CONFIRMED',
  emailVerified: true,
  linkedGoogleSubs: [],
  ...overrides,
});

// Seen live in S2-07: Cognito adds a full stop after the message, so one of our own showed "..".
test.each(Object.entries(PRE_SIGN_UP_MESSAGES))(
  'message %s leaves the final full stop to Cognito',
  (_, text) => {
    expect(text).not.toMatch(/\.$/);
  },
);

// Whether Google's hd claim, mapped to custom:hd, arrived and matches the address (S2-13).
describe('hdStatus', () => {
  test.each([
    ['missing', { email: 'bob@uni.ac.nz' }],
    ['empty', { email: 'bob@uni.ac.nz', 'custom:hd': '' }],
  ])('is absent when hd is %s', (_, attributes) => {
    expect(hdStatus(attributes)).toBe('absent');
  });

  test('matches when the domain of the address equals hd, ignoring case', () => {
    expect(hdStatus({ email: 'Bob@Uni.AC.nz', 'custom:hd': 'UNI.ac.nz' })).toBe('matches');
  });

  test.each([
    ['another domain', 'bob@other.com'],
    ['a subdomain of hd', 'bob@mail.uni.ac.nz'],
    ['a parent domain of hd', 'bob@ac.nz'],
    ['no @ at all', 'uni.ac.nz'],
    ['no email', undefined],
  ])('differs for %s', (_, email) => {
    const attributes = { 'custom:hd': 'uni.ac.nz', ...(email ? { email } : {}) };
    expect(hdStatus(attributes)).toBe('differs');
  });
});

describe('readGoogleIdentity', () => {
  test('accepts a verified Gmail address, and reads the Google sub from the username', () => {
    expect(readGoogleIdentity(`google_${GOOGLE_SUB}`, VERIFIED_GMAIL)).toEqual(identity);
  });

  test('lowercases the address and the provider prefix', () => {
    expect(
      readGoogleIdentity(`Google_${GOOGLE_SUB}`, {
        email: 'Alice.Smith@Gmail.COM',
        email_verified: 'true',
      }),
    ).toEqual({ sub: GOOGLE_SUB, email: 'alice.smith@gmail.com' });
  });

  // Case 6: Google vouches only for Gmail addresses that it has verified.
  test.each([
    ['unverified', { email: 'alice@gmail.com', email_verified: 'false' }],
    ['verification missing', { email: 'alice@gmail.com' }],
    ['verification not exactly "true"', { email: 'alice@gmail.com', email_verified: 'yes' }],
    ['non-Gmail address', { email: 'alice@company.com', email_verified: 'true' }],
    ['googlemail.com address', { email: 'alice@googlemail.com', email_verified: 'true' }],
    ['subdomain of gmail.com', { email: 'alice@mail.gmail.com', email_verified: 'true' }],
    ['plus address', { email: 'alice+cv@gmail.com', email_verified: 'true' }],
    [
      'quote that would break the ListUsers filter',
      { email: 'a"b@gmail.com', email_verified: 'true' },
    ],
    ['email missing', { email_verified: 'true' }],
  ])('refuses as case 6: %s', (_, attributes) => {
    expect(readGoogleIdentity(`google_${GOOGLE_SUB}`, attributes)).toEqual({
      action: 'refuse',
      adrCase: 6,
      message: PRE_SIGN_UP_MESSAGES.googleNotTrusted,
    });
  });

  // Only Google is trusted for linking (ADR-0009 §2).
  test.each([
    ['another provider', `linkedin_${GOOGLE_SUB}`],
    ['no provider prefix', GOOGLE_SUB],
    ['empty provider', `_${GOOGLE_SUB}`],
    ['empty sub', 'google_'],
  ])('refuses a username that is not a Google identity: %s', (_, userName) => {
    expect(readGoogleIdentity(userName, VERIFIED_GMAIL)).toEqual({
      action: 'refuse',
      adrCase: 'other',
      message: PRE_SIGN_UP_MESSAGES.failed,
    });
  });
});

describe('decide', () => {
  test('case 4: no local user, so create one and link it', () => {
    expect(decide(identity, [])).toEqual({ action: 'create-and-link', adrCase: 4 });
  });

  test('case 3: a confirmed user with a verified email is linked', () => {
    expect(decide(identity, [localUser()])).toEqual({
      action: 'link',
      adrCase: 3,
      username: 'local-user-uuid',
      alreadyLinked: false,
    });
  });

  test('case 3 retried: a link that already exists is not made again', () => {
    expect(decide(identity, [localUser({ linkedGoogleSubs: [GOOGLE_SUB] })])).toMatchObject({
      action: 'link',
      alreadyLinked: true,
    });
  });

  test("case 3: another Google identity's link doesn't count as this one", () => {
    expect(decide(identity, [localUser({ linkedGoogleSubs: ['111'] })])).toMatchObject({
      action: 'link',
      alreadyLinked: false,
    });
  });

  // The takeover case: whoever signed up never proved they own the address.
  test.each([true, false])(
    'case 5: an unconfirmed user is deleted, never linked (emailVerified %s)',
    (emailVerified) => {
      expect(decide(identity, [localUser({ status: 'UNCONFIRMED', emailVerified })])).toEqual({
        action: 'delete-create-and-link',
        adrCase: 5,
        unconfirmedUsername: 'local-user-uuid',
      });
    },
  );

  test('case 7: a confirmed user whose email is not verified is refused', () => {
    expect(decide(identity, [localUser({ emailVerified: false })])).toEqual({
      action: 'refuse',
      adrCase: 7,
      message: PRE_SIGN_UP_MESSAGES.useYourPassword,
    });
  });

  test('case 10: a FORCE_CHANGE_PASSWORD user with a verified email gets a password and a link', () => {
    expect(decide(identity, [localUser({ status: 'FORCE_CHANGE_PASSWORD' })])).toEqual({
      action: 'set-password-and-link',
      adrCase: 10,
      username: 'local-user-uuid',
      alreadyLinked: false,
    });
  });

  test('case 10: a FORCE_CHANGE_PASSWORD user whose email is not verified is refused', () => {
    expect(
      decide(identity, [localUser({ status: 'FORCE_CHANGE_PASSWORD', emailVerified: false })]),
    ).toEqual({ action: 'refuse', adrCase: 10, message: PRE_SIGN_UP_MESSAGES.useYourPassword });
  });

  test.each(['RESET_REQUIRED', 'ARCHIVED', 'COMPROMISED', 'UNKNOWN', ''])(
    'refuses a user in a status with no rule: %s',
    (status) => {
      expect(decide(identity, [localUser({ status })])).toEqual({
        action: 'refuse',
        adrCase: 'other',
        message: PRE_SIGN_UP_MESSAGES.failed,
      });
    },
  );

  test('refuses when more than one local user has the address', () => {
    expect(decide(identity, [localUser(), localUser({ username: 'other-uuid' })])).toEqual({
      action: 'refuse',
      adrCase: 'other',
      message: PRE_SIGN_UP_MESSAGES.failed,
    });
  });

  // The rule the whole ADR rests on, checked for every combination: Google is linked to an
  // existing user only when that user is confirmed (or admin-created) and its email is verified.
  test('links to an existing user only when it is CONFIRMED or FORCE_CHANGE_PASSWORD and verified', () => {
    const statuses = ['UNCONFIRMED', 'CONFIRMED', 'FORCE_CHANGE_PASSWORD', 'RESET_REQUIRED'];
    for (const status of statuses) {
      for (const emailVerified of [true, false]) {
        for (const linkedGoogleSubs of [[], [GOOGLE_SUB]]) {
          const { action } = decide(identity, [
            localUser({ status, emailVerified, linkedGoogleSubs }),
          ]);
          const linksExisting = action === 'link' || action === 'set-password-and-link';
          const allowed =
            emailVerified && (status === 'CONFIRMED' || status === 'FORCE_CHANGE_PASSWORD');
          expect(linksExisting, `${status}, verified ${emailVerified}`).toBe(allowed);
        }
      }
    }
  });
});

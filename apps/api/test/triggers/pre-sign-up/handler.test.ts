import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';
import type { UserDirectory } from '../../../src/triggers/pre-sign-up/cognito.ts';
import { createHandler, handler } from '../../../src/triggers/pre-sign-up/handler.ts';

// The pre sign-up trigger end to end, one test per ADR-0009 §2 case (S2-07), against an in-memory
// user pool. Cases 2 and 9 never reach the trigger, so they're checked live (google-sign-in
// runbook §4).

const POOL = 'us-east-1_TestPool';
const EMAIL = 'alice@gmail.com';
const GOOGLE_SUB = '109876543210987654321';

interface FakeUser {
  email: string;
  status: string;
  emailVerified: boolean;
  linkedGoogleSubs: string[];
}

type Method = keyof UserDirectory;

// An in-memory user pool that behaves like Cognito for these five calls, and records each call
// as "<method> <username>" so tests can check the order.
function fakePool(initial: Record<string, FakeUser> = {}) {
  const users = new Map(Object.entries(initial));
  const calls: string[] = [];
  const failures = new Map<Method, Error>();
  let created = 0;

  const record = (poolId: string, method: Method, username = '') => {
    expect(poolId).toBe(POOL);
    calls.push(`${method} ${username}`.trim());
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw failure;
    }
  };
  const get = (username: string) => {
    const user = users.get(username);
    if (!user) throw new Error(`no user ${username}`);
    return user;
  };

  const directory: UserDirectory = {
    findLocalUsers: (poolId, email) => {
      record(poolId, 'findLocalUsers');
      return Promise.resolve(
        [...users]
          .filter(([, user]) => user.email === email)
          .map(([username, user]) => ({
            username,
            status: user.status,
            emailVerified: user.emailVerified,
            linkedGoogleSubs: [...user.linkedGoogleSubs],
          })),
      );
    },
    createUser: (poolId, email) => {
      record(poolId, 'createUser');
      created += 1;
      const username = `new-user-${created}`;
      users.set(username, {
        email,
        status: 'FORCE_CHANGE_PASSWORD', // what AdminCreateUser gives
        emailVerified: true,
        linkedGoogleSubs: [],
      });
      return Promise.resolve(username);
    },
    setRandomPassword: (poolId, username) => {
      record(poolId, 'setRandomPassword', username);
      get(username).status = 'CONFIRMED';
      return Promise.resolve();
    },
    linkGoogle: (poolId, username, googleSub) => {
      record(poolId, 'linkGoogle', username);
      get(username).linkedGoogleSubs.push(googleSub);
      return Promise.resolve();
    },
    deleteUser: (poolId, username) => {
      record(poolId, 'deleteUser', username);
      users.delete(username);
      return Promise.resolve();
    },
  };

  // The next call to this method throws, like a Cognito error or a timeout.
  const failNext = (method: Method, error: Error) => failures.set(method, error);
  return { directory, users, calls, failNext };
}

const user = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  email: EMAIL,
  status: 'CONFIRMED',
  emailVerified: true,
  linkedGoogleSubs: [],
  ...overrides,
});

const event = (
  triggerSource: PreSignUpTriggerEvent['triggerSource'],
  userAttributes: Record<string, string> = {
    email: EMAIL,
    email_verified: 'true',
  },
  userName = `google_${GOOGLE_SUB}`,
) =>
  ({
    version: '1',
    region: 'us-east-1',
    userPoolId: POOL,
    triggerSource,
    userName,
    callerContext: { awsSdkVersion: 'aws-sdk-js-3', clientId: 'web-client' },
    request: { userAttributes },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  }) as PreSignUpTriggerEvent;

const googleSignIn = (userAttributes?: Record<string, string>, userName?: string) =>
  event('PreSignUp_ExternalProvider', userAttributes, userName);

let log: MockInstance<typeof console.log>;
let errorLog: MockInstance<typeof console.error>;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Everything the trigger logged, as one string.
const logged = () => [...log.mock.calls, ...errorLog.mock.calls].flat().join('\n');

describe('sign-ups that are not Google sign-ins', () => {
  test.each([
    ['case 1, password sign-up', 'PreSignUp_SignUp'],
    ['case 8, admin-created user', 'PreSignUp_AdminCreateUser'],
  ] as const)('%s: allowed unchanged, with no Cognito call', async (_, triggerSource) => {
    const pool = fakePool();
    const input = event(triggerSource);
    const output = await createHandler(pool.directory)(input);
    expect(output).toBe(input);
    expect(output.response).toEqual({
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    });
    expect(pool.calls).toEqual([]);
  });

  test('an unknown trigger source is refused', async () => {
    const pool = fakePool();
    const unknown = {
      ...event('PreSignUp_SignUp'),
      triggerSource: 'PreSignUp_Other',
    };
    await expect(
      createHandler(pool.directory)(unknown as unknown as PreSignUpTriggerEvent),
    ).rejects.toThrow(PRE_SIGN_UP_MESSAGES.failed);
    expect(pool.calls).toEqual([]);
  });
});

describe('first Google sign-in', () => {
  test('case 3: links Google to the confirmed user, which keeps its username and sub', async () => {
    const pool = fakePool({ 'local-1': user() });
    const input = googleSignIn();
    await expect(createHandler(pool.directory)(input)).resolves.toBe(input);
    expect(pool.calls).toEqual(['findLocalUsers', 'linkGoogle local-1']);
    expect([...pool.users.keys()]).toEqual(['local-1']);
    expect(pool.users.get('local-1')?.linkedGoogleSubs).toEqual([GOOGLE_SUB]);
  });

  test('case 3 retried: a link that already exists is not made again', async () => {
    const pool = fakePool({
      'local-1': user({ linkedGoogleSubs: [GOOGLE_SUB] }),
    });
    await createHandler(pool.directory)(googleSignIn());
    expect(pool.calls).toEqual(['findLocalUsers']);
  });

  test('case 4: creates a confirmed local user, then links Google to it', async () => {
    const pool = fakePool();
    await createHandler(pool.directory)(googleSignIn());
    expect(pool.calls).toEqual([
      'findLocalUsers',
      'createUser',
      'setRandomPassword new-user-1',
      'linkGoogle new-user-1',
    ]);
    expect(pool.users.get('new-user-1')).toEqual({
      email: EMAIL,
      status: 'CONFIRMED',
      emailVerified: true,
      linkedGoogleSubs: [GOOGLE_SUB],
    });
  });

  // S2-13: a Workspace address follows the same cases as Gmail once Google vouches for it.
  test('case 4 with a Workspace address: creates a linked local user, and logs no domain', async () => {
    const pool = fakePool();
    await createHandler(pool.directory)(
      googleSignIn({ email: 'Bob@Uni.ac.nz', email_verified: 'true', 'custom:hd': 'uni.ac.nz' }),
    );
    expect(pool.calls).toEqual([
      'findLocalUsers',
      'createUser',
      'setRandomPassword new-user-1',
      'linkGoogle new-user-1',
    ]);
    expect(pool.users.get('new-user-1')).toEqual({
      email: 'bob@uni.ac.nz',
      status: 'CONFIRMED',
      emailVerified: true,
      linkedGoogleSubs: [GOOGLE_SUB],
    });
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ adrCase: 4, hd: 'matches' });
    expect(logged()).not.toContain('uni.ac.nz');
  });

  test('case 3 with a Workspace address: links Google to the existing local user', async () => {
    const pool = fakePool({ 'local-1': user({ email: 'bob@uni.ac.nz' }) });
    await createHandler(pool.directory)(
      googleSignIn({ email: 'bob@uni.ac.nz', email_verified: 'true', 'custom:hd': 'uni.ac.nz' }),
    );
    expect(pool.calls).toEqual(['findLocalUsers', 'linkGoogle local-1']);
  });

  test('case 5, takeover: deletes the unconfirmed user and never links it', async () => {
    const pool = fakePool({
      'attacker-1': user({ status: 'UNCONFIRMED', emailVerified: false }),
    });
    await createHandler(pool.directory)(googleSignIn());
    expect(pool.calls).toEqual([
      'findLocalUsers',
      'deleteUser attacker-1',
      'createUser',
      'setRandomPassword new-user-1',
      'linkGoogle new-user-1',
    ]);
    // A new user, with a different username and so a different sub from the unconfirmed one.
    expect([...pool.users.keys()]).toEqual(['new-user-1']);
    expect(pool.calls).not.toContain('linkGoogle attacker-1');
    expect(pool.calls).not.toContain('setRandomPassword attacker-1');
  });

  test.each([
    ['unverified', { email: EMAIL, email_verified: 'false' }],
    ['non-Gmail', { email: 'alice@company.com', email_verified: 'true' }],
  ])(
    'case 6: refuses an address Google does not vouch for (%s), with no Cognito call',
    async (_, attributes) => {
      const pool = fakePool({ 'local-1': user() });
      await expect(createHandler(pool.directory)(googleSignIn(attributes))).rejects.toThrow(
        PRE_SIGN_UP_MESSAGES.googleNotTrusted,
      );
      expect(pool.calls).toEqual([]);
    },
  );

  test('case 7: refuses when the confirmed user has an unverified email, and changes nothing', async () => {
    const pool = fakePool({ 'local-1': user({ emailVerified: false }) });
    await expect(createHandler(pool.directory)(googleSignIn())).rejects.toThrow(
      PRE_SIGN_UP_MESSAGES.useYourPassword,
    );
    expect(pool.calls).toEqual(['findLocalUsers']);
    expect(pool.users.get('local-1')).toEqual(user({ emailVerified: false }));
  });

  test('case 10: sets a password for a FORCE_CHANGE_PASSWORD user, then links it', async () => {
    const pool = fakePool({
      'admin-made-1': user({ status: 'FORCE_CHANGE_PASSWORD' }),
    });
    await createHandler(pool.directory)(googleSignIn());
    expect(pool.calls).toEqual([
      'findLocalUsers',
      'setRandomPassword admin-made-1',
      'linkGoogle admin-made-1',
    ]);
    expect(pool.users.get('admin-made-1')?.status).toBe('CONFIRMED');
  });

  test('case 10: refuses a FORCE_CHANGE_PASSWORD user whose email is not verified', async () => {
    const pool = fakePool({
      'admin-made-1': user({
        status: 'FORCE_CHANGE_PASSWORD',
        emailVerified: false,
      }),
    });
    await expect(createHandler(pool.directory)(googleSignIn())).rejects.toThrow(
      PRE_SIGN_UP_MESSAGES.useYourPassword,
    );
    expect(pool.calls).toEqual(['findLocalUsers']);
  });

  // Why case 10 exists: a retry after an interrupted case 4 finishes the same user, so the sub
  // doesn't change.
  test('a case 4 interrupted after the user is created finishes on the retry, with the same user', async () => {
    const pool = fakePool();
    const trigger = createHandler(pool.directory);
    pool.failNext('setRandomPassword', new Error('timed out'));
    await expect(trigger(googleSignIn())).rejects.toThrow(PRE_SIGN_UP_MESSAGES.failed);
    expect(pool.users.get('new-user-1')?.status).toBe('FORCE_CHANGE_PASSWORD');

    await trigger(googleSignIn());
    expect([...pool.users.keys()]).toEqual(['new-user-1']);
    expect(pool.users.get('new-user-1')).toMatchObject({
      status: 'CONFIRMED',
      linkedGoogleSubs: [GOOGLE_SUB],
    });
  });

  test('refuses an identity from a provider other than Google', async () => {
    const pool = fakePool();
    await expect(
      createHandler(pool.directory)(googleSignIn(undefined, 'linkedin_123')),
    ).rejects.toThrow(PRE_SIGN_UP_MESSAGES.failed);
    expect(pool.calls).toEqual([]);
  });

  test('refuses when more than one local user has the address', async () => {
    const pool = fakePool({ 'local-1': user(), 'local-2': user() });
    await expect(createHandler(pool.directory)(googleSignIn())).rejects.toThrow(
      PRE_SIGN_UP_MESSAGES.failed,
    );
    expect(pool.calls).toEqual(['findLocalUsers']);
  });
});

describe('errors and logs', () => {
  test('a Cognito error becomes the generic message, logged by its name only', async () => {
    const pool = fakePool({ 'local-1': user() });
    const error = new Error(`User ${EMAIL} (google_${GOOGLE_SUB}) is rate limited`);
    error.name = 'TooManyRequestsException';
    pool.failNext('linkGoogle', error);

    await expect(createHandler(pool.directory)(googleSignIn())).rejects.toThrow(
      PRE_SIGN_UP_MESSAGES.failed,
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('"error":"TooManyRequestsException"');
    expect(logged()).not.toContain(EMAIL);
    expect(logged()).not.toContain(GOOGLE_SUB);
  });

  test('something thrown that is not an Error is logged as Unknown', async () => {
    const directory = fakePool().directory;
    const failing: UserDirectory = {
      ...directory,
      // Deliberately not an Error, which only unusual code throws.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      findLocalUsers: () => Promise.reject('boom'),
    };
    await expect(createHandler(failing)(googleSignIn())).rejects.toThrow(
      PRE_SIGN_UP_MESSAGES.failed,
    );
    expect(logged()).toContain('"error":"Unknown"');
  });

  test('logs one line with the case, the action, and the duration, and no personal data', async () => {
    const pool = fakePool();
    const clock = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
    await createHandler(pool.directory, clock)(googleSignIn());

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      triggerSource: 'PreSignUp_ExternalProvider',
      adrCase: 4,
      action: 'create-and-link',
      hd: 'absent',
      durationMs: 250,
    });
    expect(logged()).not.toContain(EMAIL);
    expect(logged()).not.toContain(GOOGLE_SUB);
    expect(logged()).not.toContain('new-user-1');
  });

  test('a refusal is logged too, without the address', async () => {
    const pool = fakePool();
    await expect(
      createHandler(pool.directory)(
        googleSignIn({ email: 'bob@company.com', email_verified: 'true' }),
      ),
    ).rejects.toThrow(PRE_SIGN_UP_MESSAGES.googleNotTrusted);
    expect(logged()).toContain('"action":"refuse"');
    expect(logged()).not.toContain('bob@company.com');
  });

  // The hd status explains a case 6 refusal without the domain, which names an organization.
  test('a refused Workspace sign-in logs that hd differs, but not the domain', async () => {
    const pool = fakePool();
    await expect(
      createHandler(pool.directory)(
        googleSignIn({ email: 'bob@other.com', email_verified: 'true', 'custom:hd': 'uni.ac.nz' }),
      ),
    ).rejects.toThrow(PRE_SIGN_UP_MESSAGES.googleNotTrusted);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ adrCase: 6, hd: 'differs' });
    expect(logged()).not.toContain('uni.ac.nz');
    expect(logged()).not.toContain('other.com');
  });

  test('a sign-up that is not a Google sign-in logs no hd field', async () => {
    await createHandler(fakePool().directory)(event('PreSignUp_SignUp'));
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).not.toHaveProperty('hd');
  });
});

test('the Lambda entry point is a handler built on the real Cognito client', () => {
  expect(handler).toBeTypeOf('function');
});

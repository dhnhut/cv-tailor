import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminLinkProviderForUserCommand,
  AdminSetUserPasswordCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, test, vi } from 'vitest';
import { cognitoDirectory, linkedGoogleSubs } from '../../../src/triggers/pre-sign-up/cognito.ts';

// The exact Cognito requests the trigger sends (S2-07). The IAM policy in infra/modules/auth/main.tf
// allows these five actions only, so a new command here needs a policy change too.

const POOL = 'us-east-1_TestPool';
const GOOGLE_SUB = '109876543210987654321';

const setup = (response: unknown = {}) => {
  const send = vi.fn<(command: unknown) => Promise<unknown>>().mockResolvedValue(response);
  return { send, directory: cognitoDirectory({ send }) };
};

// The one command sent, its class, and its exact input.
const expectOnlyCommand = (
  send: ReturnType<typeof setup>['send'],
  type: abstract new (...args: never[]) => { input: unknown },
  input: unknown,
) => {
  expect(send).toHaveBeenCalledTimes(1);
  const command = send.mock.calls[0]?.[0];
  expect(command).toBeInstanceOf(type);
  expect((command as { input: unknown }).input).toEqual(input);
};

const identities = (...providers: { providerName: string; userId: string }[]) =>
  JSON.stringify(providers.map((p) => ({ ...p, primary: 'false', dateCreated: '1' })));

describe('findLocalUsers', () => {
  test('lists the users with this email address', async () => {
    const { send, directory } = setup({ Users: [] });
    await expect(directory.findLocalUsers(POOL, 'alice@gmail.com')).resolves.toEqual([]);
    expectOnlyCommand(send, ListUsersCommand, {
      UserPoolId: POOL,
      Filter: 'email = "alice@gmail.com"',
    });
  });

  test('reads each local user, and leaves out Google profiles that were never linked', async () => {
    const { directory } = setup({
      Users: [
        {
          Username: 'local-uuid',
          UserStatus: 'CONFIRMED',
          Attributes: [
            { Name: 'email', Value: 'alice@gmail.com' },
            { Name: 'email_verified', Value: 'true' },
            {
              Name: 'identities',
              Value: identities({ providerName: 'Google', userId: GOOGLE_SUB }),
            },
          ],
        },
        { Username: 'google_999', UserStatus: 'EXTERNAL_PROVIDER', Attributes: [] },
        { Username: 'unconfirmed-uuid', UserStatus: 'UNCONFIRMED' },
      ],
    });
    await expect(directory.findLocalUsers(POOL, 'alice@gmail.com')).resolves.toEqual([
      {
        username: 'local-uuid',
        status: 'CONFIRMED',
        emailVerified: true,
        linkedGoogleSubs: [GOOGLE_SUB],
      },
      {
        username: 'unconfirmed-uuid',
        status: 'UNCONFIRMED',
        emailVerified: false,
        linkedGoogleSubs: [],
      },
    ]);
  });

  test('treats a missing user list or status as empty', async () => {
    await expect(setup({}).directory.findLocalUsers(POOL, 'alice@gmail.com')).resolves.toEqual([]);
    await expect(
      setup({ Users: [{ Username: 'local-uuid' }] }).directory.findLocalUsers(
        POOL,
        'alice@gmail.com',
      ),
    ).resolves.toEqual([
      { username: 'local-uuid', status: '', emailVerified: false, linkedGoogleSubs: [] },
    ]);
  });

  test('fails rather than guess when a user has no username', async () => {
    const { directory } = setup({ Users: [{ UserStatus: 'CONFIRMED' }] });
    await expect(directory.findLocalUsers(POOL, 'alice@gmail.com')).rejects.toThrow(
      'ListUsers returned a user without a username',
    );
  });
});

describe('createUser', () => {
  test('creates a user with a verified email, sends no invitation, and returns its username', async () => {
    const { send, directory } = setup({ User: { Username: 'new-uuid' } });
    await expect(directory.createUser(POOL, 'alice@gmail.com')).resolves.toBe('new-uuid');
    expectOnlyCommand(send, AdminCreateUserCommand, {
      UserPoolId: POOL,
      Username: 'alice@gmail.com',
      UserAttributes: [
        { Name: 'email', Value: 'alice@gmail.com' },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
    });
  });

  test('fails when Cognito returns no username', async () => {
    await expect(setup({}).directory.createUser(POOL, 'alice@gmail.com')).rejects.toThrow(
      'AdminCreateUser returned no username',
    );
  });
});

describe('setRandomPassword', () => {
  test('sets a permanent, random 43-character password', async () => {
    const { send, directory } = setup();
    await directory.setRandomPassword(POOL, 'new-uuid');
    expectOnlyCommand(send, AdminSetUserPasswordCommand, {
      UserPoolId: POOL,
      Username: 'new-uuid',
      Password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      Permanent: true,
    });
  });

  test('never sets the same password twice', async () => {
    const { send, directory } = setup();
    await directory.setRandomPassword(POOL, 'a');
    await directory.setRandomPassword(POOL, 'b');
    const [first, second] = send.mock.calls.map(
      ([command]) => (command as AdminSetUserPasswordCommand).input.Password,
    );
    expect(first).not.toBe(second);
  });
});

describe('linkGoogle', () => {
  test("links Google's sub to the local user", async () => {
    const { send, directory } = setup();
    await directory.linkGoogle(POOL, 'local-uuid', GOOGLE_SUB);
    expectOnlyCommand(send, AdminLinkProviderForUserCommand, {
      UserPoolId: POOL,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'local-uuid' },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: GOOGLE_SUB,
      },
    });
  });
});

describe('deleteUser', () => {
  test('deletes the user', async () => {
    const { send, directory } = setup();
    await directory.deleteUser(POOL, 'unconfirmed-uuid');
    expectOnlyCommand(send, AdminDeleteUserCommand, {
      UserPoolId: POOL,
      Username: 'unconfirmed-uuid',
    });
  });
});

describe('linkedGoogleSubs', () => {
  test('returns the Google subs only', () => {
    expect(
      linkedGoogleSubs(
        identities(
          { providerName: 'Google', userId: GOOGLE_SUB },
          { providerName: 'LinkedIn', userId: 'li-1' },
        ),
      ),
    ).toEqual([GOOGLE_SUB]);
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['not JSON', 'not json'],
    ['not an array', '{"providerName":"Google","userId":"1"}'],
    ['entries of the wrong shape', '[null, 1, {"providerName":"Google"}, {"userId":"1"}]'],
  ])('treats an unreadable value as no links: %s', (_, value) => {
    expect(linkedGoogleSubs(value)).toEqual([]);
  });
});

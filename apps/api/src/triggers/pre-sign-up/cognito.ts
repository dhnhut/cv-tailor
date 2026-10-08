// The Cognito calls the pre sign-up trigger makes (S2-07). One command per function and no
// decisions: rules.ts decides, and handler.ts calls these in order. The IAM policy in
// infra/modules/auth/main.tf allows exactly these five actions, on this user pool only.
import { randomBytes } from 'node:crypto';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminLinkProviderForUserCommand,
  AdminSetUserPasswordCommand,
  type AttributeType,
  type CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { GOOGLE_PROVIDER, type LocalUser } from './rules.ts';

// Only the client's send method, so tests can pass { send: vi.fn() }.
export type CognitoSend = Pick<CognitoIdentityProviderClient, 'send'>;

export interface UserDirectory {
  findLocalUsers(poolId: string, email: string): Promise<LocalUser[]>;
  createUser(poolId: string, email: string): Promise<string>; // returns the new username
  setRandomPassword(poolId: string, username: string): Promise<void>;
  linkGoogle(poolId: string, username: string, googleSub: string): Promise<void>;
  deleteUser(poolId: string, username: string): Promise<void>;
}

// A Google profile with its own sub, made by a first Google sign-in before this trigger existed
// (google-sign-in runbook §3). It isn't a local user, so it's never a link target.
const EXTERNAL_PROVIDER = 'EXTERNAL_PROVIDER';

const attribute = (attributes: AttributeType[] | undefined, name: string): string | undefined =>
  attributes?.find((a) => a.Name === name)?.Value;

const isGoogleIdentity = (value: unknown): value is { providerName: string; userId: string } =>
  typeof value === 'object' &&
  value !== null &&
  'providerName' in value &&
  value.providerName === GOOGLE_PROVIDER &&
  'userId' in value &&
  typeof value.userId === 'string';

// `identities` is a JSON array of the identities linked to a user, for example
// [{"providerName":"Google","userId":"1234",…}]. userId is Google's sub. Unreadable means none.
export function linkedGoogleSubs(identities: string | undefined): string[] {
  if (!identities) return [];
  try {
    const parsed: unknown = JSON.parse(identities);
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter(isGoogleIdentity).map((i) => i.userId)
      : [];
  } catch {
    return [];
  }
}

export const cognitoDirectory = (client: CognitoSend): UserDirectory => ({
  async findLocalUsers(poolId, email) {
    // rules.ts accepts no `"`, `\`, whitespace, or control characters, and at most 246 characters,
    // so the address stays inside the quotes and the filter stays within 256 characters.
    const { Users = [] } = await client.send(
      new ListUsersCommand({ UserPoolId: poolId, Filter: `email = "${email}"` }),
    );
    return Users.filter((user) => user.UserStatus !== EXTERNAL_PROVIDER).map((user) => {
      if (!user.Username) throw new Error('ListUsers returned a user without a username');
      return {
        username: user.Username,
        status: user.UserStatus ?? '',
        emailVerified: attribute(user.Attributes, 'email_verified') === 'true',
        linkedGoogleSubs: linkedGoogleSubs(attribute(user.Attributes, 'identities')),
      };
    });
  },

  async createUser(poolId, email) {
    // This invokes the trigger again, as PreSignUp_AdminCreateUser (case 8), which allows it.
    const { User } = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email, // the pool uses the email as the username, and makes a UUID username
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' }, // Google verified it (rules.ts, case 6)
        ],
        MessageAction: 'SUPPRESS', // no invitation email: the person is signing in with Google now
      }),
    );
    if (!User?.Username) throw new Error('AdminCreateUser returned no username');
    return User.Username;
  },

  async setRandomPassword(poolId, username) {
    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: poolId,
        Username: username,
        // Nobody knows this password. The person can set their own with "Forgot password", which
        // Cognito allows only once the user is CONFIRMED, as Permanent makes it.
        Password: randomBytes(32).toString('base64url'),
        Permanent: true,
      }),
    );
  },

  async linkGoogle(poolId, username, googleSub) {
    await client.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: poolId,
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: username },
        SourceUser: {
          ProviderName: GOOGLE_PROVIDER,
          ProviderAttributeName: 'Cognito_Subject', // link by Google's sub, not by email
          ProviderAttributeValue: googleSub,
        },
      }),
    );
  },

  async deleteUser(poolId, username) {
    await client.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: username }));
  },
});

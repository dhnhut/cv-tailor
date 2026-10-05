// Pre sign-up trigger (S2-07). On a person's first Google sign-in, it links Google to their local
// user, creating that user first if needed, so their sub never changes (ADR-0009 §1–§2). Cognito
// also invokes it for SignUp and AdminCreateUser, which it allows.
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';
import { cognitoDirectory, type UserDirectory } from './cognito.ts';
import {
  decide,
  type Decision,
  type GoogleIdentity,
  hdStatus,
  readGoogleIdentity,
} from './rules.ts';

async function createAndLink(directory: UserDirectory, poolId: string, identity: GoogleIdentity) {
  const username = await directory.createUser(poolId, identity.email);
  await directory.setRandomPassword(poolId, username);
  await directory.linkGoogle(poolId, username, identity.sub);
}

async function linkGoogleSignIn(
  event: PreSignUpTriggerEvent,
  directory: UserDirectory,
): Promise<Decision> {
  const poolId = event.userPoolId;
  const identity = readGoogleIdentity(event.userName, event.request.userAttributes);
  if ('action' in identity) return identity; // refused before any Cognito call (case 6)

  const decision = decide(identity, await directory.findLocalUsers(poolId, identity.email));
  switch (decision.action) {
    case 'delete-create-and-link':
      // Case 5: the unconfirmed user is deleted, never linked. Deleting it frees the address.
      await directory.deleteUser(poolId, decision.unconfirmedUsername);
      await createAndLink(directory, poolId, identity);
      break;
    case 'create-and-link':
      await createAndLink(directory, poolId, identity);
      break;
    case 'set-password-and-link':
    case 'link':
      if (decision.action === 'set-password-and-link') {
        await directory.setRandomPassword(poolId, decision.username);
      }
      if (!decision.alreadyLinked) {
        await directory.linkGoogle(poolId, decision.username, identity.sub);
      }
      break;
  }
  return decision;
}

async function run(event: PreSignUpTriggerEvent, directory: UserDirectory): Promise<Decision> {
  switch (event.triggerSource) {
    case 'PreSignUp_SignUp':
      // Case 1. The Turnstile check goes here before the first prod release (ADR-0009 §8).
      return { action: 'allow', adrCase: 1 };
    case 'PreSignUp_AdminCreateUser':
      // Case 8, including the nested call from createAndLink.
      return { action: 'allow', adrCase: 8 };
    case 'PreSignUp_ExternalProvider':
      return await linkGoogleSignIn(event, directory);
    default:
      return { action: 'refuse', adrCase: 'other', message: PRE_SIGN_UP_MESSAGES.failed };
  }
}

// Logs never contain the email address, a sub, a username, or the event itself (SAFE-04).
export const createHandler =
  (directory: UserDirectory, now: () => number = Date.now) =>
  async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
    const started = now();
    let decision: Decision;
    try {
      decision = await run(event, directory);
    } catch (error) {
      // Only the error's name: SDK messages can include the username or the email address.
      const name = error instanceof Error ? error.name : 'Unknown';
      console.error(
        JSON.stringify({
          triggerSource: event.triggerSource,
          outcome: 'error',
          error: name,
          durationMs: now() - started,
        }),
      );
      // No `cause`: Lambda logs a thrown error, and the original's message may hold the address.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(PRE_SIGN_UP_MESSAGES.failed);
    }

    const { action, adrCase } = decision;
    console.log(
      JSON.stringify({
        triggerSource: event.triggerSource,
        adrCase,
        action,
        // Whether Google's hd claim arrived and matches the address. Never the domain (SAFE-04).
        ...(event.triggerSource === 'PreSignUp_ExternalProvider'
          ? { hd: hdStatus(event.request.userAttributes) }
          : {}),
        durationMs: now() - started,
      }),
    );
    // Managed login shows this message to the person.
    if (decision.action === 'refuse') throw new Error(decision.message);
    // Unchanged: never auto-confirm or auto-verify. Google's verified address comes from the mapping.
    return event;
  };

// Cognito waits 5 seconds for the whole trigger, including the nested AdminCreateUser call, which
// runs this function again. Short timeouts and at most one retry keep it inside that limit.
const client = new CognitoIdentityProviderClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 1_500 },
});

export const handler = createHandler(cognitoDirectory(client));

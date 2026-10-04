import type { WebConfig } from '@cv-tailor/contracts';
import type { AuthContextProps } from 'react-oidc-context';
import { browser } from '../browser';
import { SIGN_OUT_PATH } from './settings';

// Cognito's /logout ends the managed login session, then returns to the app. It doesn't sign the
// person out of Google (ADR-0009 §5).
export function logoutUrl(config: WebConfig, origin: string): string {
  const url = new URL('/logout', config.authUrl);
  url.searchParams.set('client_id', config.webClientId);
  url.searchParams.set('logout_uri', `${origin}${SIGN_OUT_PATH}`);
  return url.href;
}

// Sign-out in ADR-0009 §5's order: revoke the refresh token, clear the stored tokens, then end the
// managed login session. Call it from a page that doesn't require sign-in (see Layout).
export async function signOut(
  auth: Pick<AuthContextProps, 'revokeTokens' | 'removeUser'>,
  config: WebConfig,
): Promise<void> {
  try {
    await auth.revokeTokens(); // the refresh token only (settings.ts)
  } catch (error) {
    // Sign out here anyway: the person asked to, and the token expires within a day (S2-05).
    console.error(error);
  }
  await auth.removeUser();
  browser.assign(logoutUrl(config, window.location.origin));
}

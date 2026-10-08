import type { WebConfig } from '@cv-tailor/contracts';
import { type UserManagerSettings, WebStorageStateStore } from 'oidc-client-ts';

// Must match sign_in_callback_path and sign_out_path in infra/modules/auth/variables.tf: Cognito accepts
// only the exact URLs registered on the app client.
export const CALLBACK_PATH = '/auth/callback';
export const SIGN_OUT_PATH = '/';

// The web app's sign-in settings (ADR-0009 §5): the authorization code flow with PKCE, through
// managed login at auth.<host>.
export function authSettings(config: WebConfig, origin: string): UserManagerSettings {
  // The pool ID starts with its region (us-east-1_AbC123), which the issuer URL needs.
  const region = config.userPoolId.slice(0, config.userPoolId.indexOf('_'));
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${config.userPoolId}`;
  const sessionStore = new WebStorageStateStore({ store: window.sessionStorage });

  return {
    authority: issuer,
    client_id: config.webClientId,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: 'code', // the library always adds PKCE; Cognito can't require it (S2-05)
    scope: 'openid email cv-tailor-api/user', // the API accepts only this scope (ADR-0009 §6)
    // Cognito's endpoints, as its discovery document lists them (checked on dev, 2026-10-04).
    // Written out, so the app never fetches that document and the CSP needs only auth.<host>.
    metadata: {
      issuer,
      authorization_endpoint: `${config.authUrl}/oauth2/authorize`,
      token_endpoint: `${config.authUrl}/oauth2/token`,
      revocation_endpoint: `${config.authUrl}/oauth2/revoke`,
    },
    // sessionStorage, as ADR-0009 §5 decides: cleared when the tab closes. The library keeps
    // sign-in state, which holds the PKCE verifier, in localStorage by default.
    userStore: sessionStore,
    stateStore: sessionStore,
    // Revoking the refresh token also revokes the access tokens issued from it (sign-out).
    revokeTokenTypes: ['refresh_token'],
  };
}

import { render } from '@testing-library/react';
import { User, UserManager } from 'oidc-client-ts';
import { App } from '../src/App';
import { authSettings } from '../src/auth/settings';
import { DEV_CONFIG } from './fixtures';

export const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
export const EMAIL = 'alice@gmail.com';

// dev's real settings. No silent renew: its timers would outlive the test.
export const testUserManager = () =>
  new UserManager({
    ...authSettings(DEV_CONFIG, window.location.origin),
    automaticSilentRenew: false,
  });

// What a finished sign-in returns: tokens valid for an hour, and the state the sign-in carried.
export const signedInUser = (state?: unknown) =>
  new User({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    profile: { sub: SUB, email: EMAIL, iss: 'issuer', aud: DEV_CONFIG.webClientId, exp: 0, iat: 0 },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    userState: state,
  });

// Opens the app at `path`, as a page load would.
export const renderApp = (userManager: UserManager, path = '/') => {
  window.history.replaceState(null, '', path);
  return render(<App config={DEV_CONFIG} userManager={userManager} />);
};

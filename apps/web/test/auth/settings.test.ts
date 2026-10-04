import { expect, test } from 'vitest';
import { authSettings } from '../../src/auth/settings';
import { DEV_CONFIG } from '../fixtures';

const settings = authSettings(DEV_CONFIG, 'https://dev.cv.ikiwii.com');

test('uses the pool as issuer, with the region taken from the pool ID', () => {
  expect(settings.authority).toBe(
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbCdEf123',
  );
  expect(settings.metadata?.issuer).toBe(settings.authority);
});

// Written out literally: the same values Cognito's discovery document lists (checked live).
test("uses Cognito's endpoints on the sign-in domain", () => {
  expect(settings.metadata).toMatchObject({
    authorization_endpoint: 'https://auth.dev.cv.ikiwii.com/oauth2/authorize',
    token_endpoint: 'https://auth.dev.cv.ikiwii.com/oauth2/token',
    revocation_endpoint: 'https://auth.dev.cv.ikiwii.com/oauth2/revoke',
  });
});

test('returns to the callback path on the page origin', () => {
  expect(settings.redirect_uri).toBe('https://dev.cv.ikiwii.com/auth/callback');
  expect(authSettings(DEV_CONFIG, 'http://localhost:5173').redirect_uri).toBe(
    'http://localhost:5173/auth/callback',
  );
});

test('asks for the code flow, the email, and the API scope', () => {
  expect(settings).toMatchObject({
    client_id: '1example23456789abcdefghij',
    response_type: 'code',
    scope: 'openid email cv-tailor-api/user',
    revokeTokenTypes: ['refresh_token'],
  });
});

// ADR-0009 §5: nothing about sign-in may outlive the tab.
test('keeps tokens and sign-in state in sessionStorage', async () => {
  await settings.userStore?.set('probe', 'x');
  await settings.stateStore?.set('probe2', 'y');
  expect(Object.keys(sessionStorage)).toEqual(
    expect.arrayContaining(['oidc.probe', 'oidc.probe2']),
  );
  expect(localStorage.length).toBe(0);
});

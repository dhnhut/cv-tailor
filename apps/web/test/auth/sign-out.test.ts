import { afterEach, expect, test, vi } from 'vitest';
import { browser } from '../../src/browser';
import { logoutUrl, signOut } from '../../src/auth/sign-out';
import { DEV_CONFIG } from '../fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

test('builds the /logout URL with the client ID and the exact logout URI', () => {
  expect(logoutUrl(DEV_CONFIG, 'https://dev.cv.ikiwii.com')).toBe(
    'https://auth.dev.cv.ikiwii.com/logout?client_id=1example23456789abcdefghij&logout_uri=https%3A%2F%2Fdev.cv.ikiwii.com%2F',
  );
});

const recordingAuth = (calls: string[], revoke: () => Promise<void>) => ({
  revokeTokens: vi.fn(() => {
    calls.push('revoke');
    return revoke();
  }),
  removeUser: vi.fn(() => {
    calls.push('remove');
    return Promise.resolve();
  }),
});

test('revokes, clears, then ends the managed login session, in that order', async () => {
  const calls: string[] = [];
  vi.spyOn(browser, 'assign').mockImplementation((url) => void calls.push(url));

  await signOut(
    recordingAuth(calls, () => Promise.resolve()),
    DEV_CONFIG,
  );
  expect(calls).toEqual(['revoke', 'remove', logoutUrl(DEV_CONFIG, window.location.origin)]);
});

test('still signs out when revocation fails, and logs the error', async () => {
  const calls: string[] = [];
  const failure = new TypeError('Failed to fetch');
  vi.spyOn(browser, 'assign').mockImplementation((url) => void calls.push(url));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  await signOut(
    recordingAuth(calls, () => Promise.reject(failure)),
    DEV_CONFIG,
  );
  expect(calls).toEqual(['revoke', 'remove', logoutUrl(DEV_CONFIG, window.location.origin)]);
  expect(consoleError.mock.calls).toEqual([[failure]]);
});

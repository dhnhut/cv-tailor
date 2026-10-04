import { expect, test } from 'vitest';
import { returnPath } from '../../src/auth/return-path';

test('returns to the page that asked for sign-in', () => {
  expect(returnPath({ returnTo: '/profile' })).toBe('/profile');
});

test.each([
  ['no state', undefined],
  ['a string state', '/profile'],
  ['no returnTo', {}],
  ['a non-string returnTo', { returnTo: 42 }],
  ['a relative path', { returnTo: 'profile' }],
  ['a protocol-relative URL', { returnTo: '//evil.com' }],
  ['a backslash URL', { returnTo: '/\\evil.com' }],
  ['an absolute URL', { returnTo: 'https://evil.com/' }],
])('falls back to / for %s', (_, state) => {
  expect(returnPath(state)).toBe('/');
});

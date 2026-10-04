import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';
import { expect, test } from 'vitest';
import { GENERIC_SIGN_IN_ERROR, signInErrorMessage } from '../../src/auth/callback-error';

const callback = (description?: string) =>
  `?${new URLSearchParams({ error: 'invalid_request', ...(description === undefined ? {} : { error_description: description }) })}`;

test.each(Object.values(PRE_SIGN_UP_MESSAGES))(
  'shows the trigger message "%s" without the prefix',
  (text) => {
    expect(signInErrorMessage(callback(`PreSignUp failed with error ${text}.`))).toBe(`${text}.`);
  },
);

// Content spoofing: anyone can send a callback link with their own text.
test('shows the generic message for any other description', () => {
  expect(signInErrorMessage(callback('PreSignUp failed with error Call 0800 000 000.'))).toBe(
    GENERIC_SIGN_IN_ERROR,
  );
  expect(signInErrorMessage(callback('invalid_scope'))).toBe(GENERIC_SIGN_IN_ERROR);
  expect(signInErrorMessage(callback())).toBe(GENERIC_SIGN_IN_ERROR);
});

test('returns null when the URL has no error', () => {
  expect(signInErrorMessage('?code=abc&state=xyz')).toBeNull();
  expect(signInErrorMessage('')).toBeNull();
});

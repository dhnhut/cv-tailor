import { expect, test } from 'vitest';
import { PRE_SIGN_UP_MESSAGES } from '../src/sign-in-messages.ts';

// Seen live in S2-07: Cognito adds a full stop after the message, so one of our own showed "..".
test.each(Object.entries(PRE_SIGN_UP_MESSAGES))(
  'message %s leaves the final full stop to Cognito',
  (_, text) => {
    expect(text).not.toMatch(/\.$/);
  },
);

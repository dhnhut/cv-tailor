import { expect, test } from 'vitest';
import { contracts, MeResponse } from '../src/index.ts';

// GET /me's body (S2-09). The API parses it before sending, and the web app parses it on receipt.

const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';

test('accepts the body GET /me returns', () => {
  expect(MeResponse.parse({ sub: SUB, isAdmin: false })).toEqual({ sub: SUB, isAdmin: false });
  expect(MeResponse.parse({ sub: SUB, isAdmin: true })).toEqual({ sub: SUB, isAdmin: true });
});

// The same rule as apps/api/src/data/keys.ts: a Cognito sub is a lowercase UUID.
test.each([
  ['an uppercase sub', { sub: SUB.toUpperCase(), isAdmin: false }],
  ['a sub that is not a UUID', { sub: 'alice@gmail.com', isAdmin: false }],
  ['an empty sub', { sub: '', isAdmin: false }],
  ['a missing sub', { isAdmin: false }],
  ['a missing isAdmin', { sub: SUB }],
  ['isAdmin as a string', { sub: SUB, isAdmin: 'true' }],
])('rejects %s', (_, body) => {
  expect(MeResponse.safeParse(body).success).toBe(false);
});

// SAFE-04: the API never returns an email address. strictObject makes an added field fail here.
test('rejects unknown keys, such as an email address', () => {
  expect(MeResponse.safeParse({ sub: SUB, isAdmin: false, email: 'alice@gmail.com' }).success).toBe(
    false,
  );
});

// Registered contracts get JSON Schema and Pydantic files. Python never reads this one.
test('is not registered for code generation', () => {
  expect(contracts.get(MeResponse)).toBeUndefined();
});

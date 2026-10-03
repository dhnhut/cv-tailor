import type { APIGatewayProxyEvent } from 'aws-lambda';
import { describe, expect, test } from 'vitest';
import { ADMIN_GROUP, parseGroups, readCaller } from '../../../src/handlers/me/claims.ts';

// Reading the caller from the authorizer's claims (S2-09). The cognito:groups format isn't
// documented for REST APIs, so every format seen is a case here.

const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';

// Only the part of the event that readCaller reads.
const eventWith = (authorizer: unknown) =>
  ({ requestContext: { authorizer } }) as unknown as APIGatewayProxyEvent;
const accessClaims = (extra: Record<string, unknown> = {}) => ({
  claims: { sub: SUB, token_use: 'access', ...extra },
});

// Written out, so a renamed group in either place is noticed.
test('the admin group is named admin, as in infra/lib/auth-stack.ts', () => {
  expect(ADMIN_GROUP).toBe('admin');
});

describe('parseGroups', () => {
  test.each([
    ['one group', 'admin', ['admin']],
    ['comma-separated', 'admin,editors', ['admin', 'editors']],
    ['comma and space', 'editors, admin', ['editors', 'admin']],
    ['bracketed, space-separated', '[admin editors]', ['admin', 'editors']],
    ['bracketed, one group', '[admin]', ['admin']],
    ['surrounding whitespace', '  admin  ', ['admin']],
    ['an array', ['admin', 'editors'], ['admin', 'editors']],
    ['an array with a non-string', ['admin', 1], ['admin']],
    ['an empty string', '', []],
    ['empty brackets', '[]', []],
    ['missing', undefined, []],
    ['a number', 42, []],
  ])('%s', (_, value, expected) => {
    expect(parseGroups(value)).toEqual(expected);
  });
});

describe('readCaller', () => {
  test('reads a caller with no groups as not an admin', () => {
    expect(readCaller(eventWith(accessClaims()))).toEqual({ sub: SUB, isAdmin: false });
  });

  test.each(['admin', 'editors,admin', '[editors admin]'])('reads %s as an admin', (groups) => {
    expect(readCaller(eventWith(accessClaims({ 'cognito:groups': groups })))).toEqual({
      sub: SUB,
      isAdmin: true,
    });
  });

  // Group names are case-sensitive, and only the exact name counts.
  test.each(['Admin', 'admins', 'administrators', 'not-admin'])('%s is not admin', (groups) => {
    expect(readCaller(eventWith(accessClaims({ 'cognito:groups': groups })))?.isAdmin).toBe(false);
  });

  test.each([
    ['no authorizer', undefined],
    ['a null authorizer', null],
    ['no claims', {}],
    ['claims that are not an object', { claims: 'sub' }],
    ['no sub', { claims: { token_use: 'access' } }],
    ['a sub that is not a string', { claims: { sub: 42, token_use: 'access' } }],
    ['no token_use', { claims: { sub: SUB } }],
    ['an ID token', { claims: { sub: SUB, token_use: 'id' } }],
  ])('returns undefined for %s', (_, authorizer) => {
    expect(readCaller(eventWith(authorizer))).toBeUndefined();
  });
});

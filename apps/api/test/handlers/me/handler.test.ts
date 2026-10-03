import type { APIGatewayProxyEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { MeResponse } from '@cv-tailor/contracts';
import type { ProfileStore } from '../../../src/data/profiles.ts';
import { createHandler, handler } from '../../../src/handlers/me/handler.ts';

// GET /me end to end (S2-09), against an in-memory profile table.

// handler.ts reads its settings when it loads. vi.hoisted runs before the imports above.
vi.hoisted(() => {
  process.env.TABLE_NAME = 'cv-tailor-test-data';
  process.env.ALLOWED_ORIGIN = 'https://dev.cv.ikiwii.com';
});

const ORIGIN = 'https://dev.cv.ikiwii.com';
const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const AT = new Date('2026-10-03T09:15:00.000Z');
const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': ORIGIN,
  'cache-control': 'no-store',
};

// An in-memory profile table that records each call. `failure` makes every call fail.
function fakeStore(failure?: Error) {
  const profiles = new Map<string, string>(); // sub → createdAt
  const calls: string[] = [];
  const store: ProfileStore = {
    ensureProfile: (sub, at) => {
      calls.push(sub);
      if (failure) return Promise.reject(failure);
      if (profiles.has(sub)) return Promise.resolve('existing');
      profiles.set(sub, at.toISOString());
      return Promise.resolve('created');
    },
  };
  return { store, profiles, calls };
}

// Only the part of the event the handler reads: the authorizer's claims.
const eventWith = (claims?: Record<string, unknown>) =>
  ({
    requestContext: { authorizer: claims ? { claims } : undefined },
  }) as unknown as APIGatewayProxyEvent;
const accessToken = (extra: Record<string, unknown> = {}) =>
  eventWith({ sub: SUB, token_use: 'access', scope: 'cv-tailor-api/user', ...extra });

const run = (store: ProfileStore, event: APIGatewayProxyEvent) =>
  createHandler({ store, allowedOrigin: ORIGIN, now: () => AT })(event);

let log: MockInstance;
let error: MockInstance;
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Every log line, parsed, in order (console.log and console.error together).
const logged = () =>
  [...log.mock.calls, ...error.mock.calls].map(([text]) => JSON.parse(text as string) as unknown);

describe('GET /me', () => {
  test('returns the caller, and creates their profile on the first call', async () => {
    const { store, profiles } = fakeStore();

    const result = await run(store, accessToken());

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual(HEADERS);
    expect(MeResponse.parse(JSON.parse(result.body))).toEqual({ sub: SUB, isAdmin: false });
    expect(profiles.get(SUB)).toBe('2026-10-03T09:15:00.000Z');
    expect(logged()).toEqual([
      { route: 'GET /me', outcome: 'created', isAdmin: false, durationMs: 0 },
    ]);
  });

  test('returns the same body on later calls, and keeps the first createdAt', async () => {
    const { store, profiles } = fakeStore();
    const first = await run(store, accessToken());

    const later = createHandler({
      store,
      allowedOrigin: ORIGIN,
      now: () => new Date('2026-10-04T00:00:00.000Z'),
    });
    const second = await later(accessToken());

    expect(second.body).toBe(first.body);
    expect(profiles.get(SUB)).toBe('2026-10-03T09:15:00.000Z');
    expect(logged()[1]).toMatchObject({ outcome: 'existing' });
  });

  test('shows a member of the admin group as an admin', async () => {
    const result = await run(fakeStore().store, accessToken({ 'cognito:groups': 'admin' }));

    expect(JSON.parse(result.body)).toEqual({ sub: SUB, isAdmin: true });
    expect(logged()[0]).toMatchObject({ isAdmin: true });
  });

  test('refuses a request without claims, and touches no data', async () => {
    const { store, calls } = fakeStore();

    const result = await run(store, eventWith());

    expect(result.statusCode).toBe(500);
    expect(result.headers).toEqual(HEADERS);
    expect(JSON.parse(result.body)).toEqual({ message: 'Internal server error' });
    expect(calls).toEqual([]);
    expect(logged()).toEqual([{ route: 'GET /me', outcome: 'no-claims', durationMs: 0 }]);
  });

  test('refuses an ID token, if one ever gets past the authorizer', async () => {
    const { store, calls } = fakeStore();

    const result = await run(store, eventWith({ sub: SUB, token_use: 'id' }));

    expect(result.statusCode).toBe(500);
    expect(calls).toEqual([]);
  });

  test('refuses a sub that breaks the contract, and writes nothing', async () => {
    const { store, calls } = fakeStore();

    const result = await run(store, accessToken({ sub: 'ALICE@GMAIL.COM' }));

    expect(result.statusCode).toBe(500);
    expect(calls).toEqual([]);
    expect(logged()[0]).toMatchObject({ outcome: 'error', error: 'ZodError' });
  });

  test('returns a 500 with no detail when the table fails, and logs only the error name', async () => {
    const failure = Object.assign(new Error(`Throttled on USER#${SUB}`), {
      name: 'ProvisionedThroughputExceededException',
    });

    const result = await run(fakeStore(failure).store, accessToken());

    expect(result.statusCode).toBe(500);
    expect(result.headers).toEqual(HEADERS);
    expect(JSON.parse(result.body)).toEqual({ message: 'Internal server error' });
    expect(logged()).toEqual([
      {
        route: 'GET /me',
        outcome: 'error',
        error: 'ProvisionedThroughputExceededException',
        durationMs: 0,
      },
    ]);
  });

  test('something thrown that is not an Error is logged as Unknown', async () => {
    const failing: ProfileStore = {
      // Deliberately not an Error, which only unusual code throws.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      ensureProfile: () => Promise.reject('boom'),
    };

    const result = await run(failing, accessToken());

    expect(result.statusCode).toBe(500);
    expect(logged()[0]).toMatchObject({ outcome: 'error', error: 'Unknown' });
  });

  // SAFE-04: across success, admin, and failure, no log line holds the sub or a claim.
  test('never logs the sub, the scope, or the groups', async () => {
    await run(fakeStore().store, accessToken({ 'cognito:groups': 'admin' }));
    await run(fakeStore(new Error(SUB)).store, accessToken());

    const text = JSON.stringify(logged());
    expect(text).not.toContain(SUB);
    expect(text).not.toContain('cv-tailor-api/user');
    expect(text).not.toContain('cognito:groups');
  });

  test('the deployed handler is built from the environment settings', () => {
    expect(handler).toBeTypeOf('function');
  });
});

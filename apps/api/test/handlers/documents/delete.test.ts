import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DeleteOutcome } from '../../../src/documents/service.ts';
import {
  createHandler,
  type DeleteDependencies,
  handler,
} from '../../../src/handlers/documents/delete.ts';
import { accessToken, adminToken, AT, captureLogs, eventWith, ORIGIN, SUB } from './events.ts';

// DELETE /documents/{id} (S3-07). The rules behind each outcome, including another user's ID,
// are tested in documents/service.test.ts.

vi.hoisted(() => {
  process.env.TABLE_NAME = 'cv-tailor-test-data';
  process.env.BUCKET_NAME = 'cv-tailor-test-documents';
  process.env.ALLOWED_ORIGIN = 'https://dev.cv.ikiwii.com';
});

const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';

const setup = (outcome: DeleteOutcome | Error) => {
  const remove = vi.fn<DeleteDependencies['remove']>(() =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
  );
  return { remove, run: createHandler({ remove, allowedOrigin: ORIGIN, now: () => AT }) };
};
const deleting = (id: string) => accessToken({ pathParameters: { id } });

let logged: () => unknown[];
beforeEach(() => {
  logged = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test('deleted: 204, no body, and the CORS header', async () => {
  const { remove, run } = setup('deleted');

  const result = await run(deleting(DOC_ID));

  expect(result).toEqual({
    statusCode: 204,
    headers: { 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store' },
    body: '',
  });
  expect(remove).toHaveBeenCalledWith(SUB, DOC_ID);
  expect(logged()).toEqual([
    { route: 'DELETE /documents/{id}', outcome: 'deleted', durationMs: 0 },
  ]);
});

// The same answer for an ID that doesn't exist and another user's document: the API never says
// whether an ID exists elsewhere.
test('not found: 404', async () => {
  const result = await setup('not-found').run(deleting(DOC_ID));

  expect(result.statusCode).toBe(404);
  expect(JSON.parse(result.body)).toMatchObject({ code: 'not-found' });
});

test.each(['upload-in-progress', 'conflict'] as const)('%s: 409 with its code', async (outcome) => {
  const result = await setup(outcome).run(deleting(DOC_ID));

  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body)).toMatchObject({ code: outcome });
});

test('an admin deletes their own documents the same way', async () => {
  const { remove, run } = setup('deleted');

  expect((await run(adminToken({ pathParameters: { id: DOC_ID } }))).statusCode).toBe(204);
  expect(remove).toHaveBeenCalledWith(SUB, DOC_ID);
});

test('a missing ID goes to the service as empty, which finds nothing', async () => {
  const { remove, run } = setup('not-found');

  expect((await run(accessToken())).statusCode).toBe(404);
  expect(remove).toHaveBeenCalledWith(SUB, '');
});

test('a request without claims: 500, and no work', async () => {
  const { remove, run } = setup('deleted');

  expect((await run(eventWith(undefined, { pathParameters: { id: DOC_ID } }))).statusCode).toBe(
    500,
  );
  expect(remove).not.toHaveBeenCalled();
});

test('an AWS error: 500, and only its name in the log', async () => {
  const { run } = setup(
    Object.assign(new Error(`kb/${SUB}/${DOC_ID}.pdf`), { name: 'NoSuchBucket' }),
  );

  const result = await run(deleting(DOC_ID));

  expect(result.statusCode).toBe(500);
  expect(logged()).toEqual([
    { route: 'DELETE /documents/{id}', outcome: 'error', error: 'NoSuchBucket', durationMs: 0 },
  ]);
});

test('never logs the sub or the document ID', async () => {
  await setup('deleted').run(deleting(DOC_ID));
  await setup(new Error(DOC_ID)).run(deleting(DOC_ID));

  const text = JSON.stringify(logged());
  expect(text).not.toContain(SUB);
  expect(text).not.toContain(DOC_ID);
});

test('the deployed handler is built from the environment settings', () => {
  expect(handler).toBeTypeOf('function');
});

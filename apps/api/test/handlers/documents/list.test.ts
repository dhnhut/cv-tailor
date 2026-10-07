import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { StoredDocument } from '../../../src/data/documents.ts';
import {
  createHandler,
  handler,
  type ListDependencies,
} from '../../../src/handlers/documents/list.ts';
import {
  accessToken,
  adminToken,
  AT,
  captureLogs,
  eventWith,
  JSON_HEADERS,
  ORIGIN,
  SUB,
} from './events.ts';

// GET /documents (S3-07). The rules behind the list are tested in documents/service.test.ts.

vi.hoisted(() => {
  process.env.TABLE_NAME = 'cv-tailor-test-data';
  process.env.BUCKET_NAME = 'cv-tailor-test-documents';
  process.env.ALLOWED_ORIGIN = 'https://dev.cv.ikiwii.com';
});

const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';
const DOCUMENT: StoredDocument = {
  id: DOC_ID,
  name: 'notes.md',
  type: 'md',
  size: 1_000,
  sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  objectKey: `kb/${SUB}/${DOC_ID}.md`,
  uploadState: 'UPLOADED',
  uploadDeadline: '2026-10-07T10:15:00.000Z',
  createdAt: '2026-10-07T09:15:00.000Z',
};

const setup = (result: Awaited<ReturnType<ListDependencies['list']>> | Error) => {
  const list = vi.fn<ListDependencies['list']>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return { list, run: createHandler({ list, allowedOrigin: ORIGIN, now: () => AT }) };
};

let logged: () => unknown[];
beforeEach(() => {
  logged = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("200 with the caller's documents, their usage, and both limits", async () => {
  const { list, run } = setup({
    documents: [DOCUMENT],
    usage: { usedBytes: 1_000, documentCount: 1 },
  });

  const result = await run(accessToken());

  expect(result.statusCode).toBe(200);
  expect(result.headers).toEqual(JSON_HEADERS);
  expect(JSON.parse(result.body)).toEqual({
    documents: [
      {
        id: DOC_ID,
        name: 'notes.md',
        type: 'md',
        size: 1_000,
        status: 'PENDING',
        createdAt: '2026-10-07T09:15:00.000Z',
      },
    ],
    usedBytes: 1_000,
    limitBytes: 50_000_000,
    documentCount: 1,
    maxDocuments: 100,
  });
  expect(list).toHaveBeenCalledWith(SUB);
  expect(logged()).toEqual([
    { route: 'GET /documents', outcome: 'listed', documents: 1, durationMs: 0 },
  ]);
});

test('an empty knowledge base', async () => {
  const { run } = setup({ documents: [], usage: { usedBytes: 0, documentCount: 0 } });

  const result = await run(accessToken());

  expect(JSON.parse(result.body)).toMatchObject({ documents: [], usedBytes: 0 });
});

test('an admin lists their own documents the same way', async () => {
  const { list, run } = setup({ documents: [], usage: { usedBytes: 0, documentCount: 0 } });

  expect((await run(adminToken())).statusCode).toBe(200);
  expect(list).toHaveBeenCalledWith(SUB);
});

// Isolation (S3-07): the sub comes from the verified token, never from the request.
test("lists the token's user, whatever the request says", async () => {
  const other = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const { list, run } = setup({ documents: [], usage: { usedBytes: 0, documentCount: 0 } });

  await run(accessToken({ queryStringParameters: { sub: other }, headers: { 'x-user': other } }));

  expect(list).toHaveBeenCalledWith(SUB);
});

test('a request without claims: 500, and no work', async () => {
  const { list, run } = setup({ documents: [], usage: { usedBytes: 0, documentCount: 0 } });

  expect((await run(eventWith())).statusCode).toBe(500);
  expect(list).not.toHaveBeenCalled();
});

test('an AWS error: 500, and only its name in the log', async () => {
  const { run } = setup(Object.assign(new Error(SUB), { name: 'SlowDown' }));

  const result = await run(accessToken());

  expect(result.statusCode).toBe(500);
  expect(logged()).toEqual([
    { route: 'GET /documents', outcome: 'error', error: 'SlowDown', durationMs: 0 },
  ]);
  expect(JSON.stringify(logged())).not.toContain(SUB);
});

test('never logs the sub or a file name', async () => {
  await setup({ documents: [DOCUMENT], usage: { usedBytes: 1_000, documentCount: 1 } }).run(
    accessToken(),
  );

  const text = JSON.stringify(logged());
  expect(text).not.toContain(SUB);
  expect(text).not.toContain('notes.md');
});

test('the deployed handler is built from the environment settings', () => {
  expect(handler).toBeTypeOf('function');
});

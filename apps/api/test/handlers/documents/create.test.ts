import type { UploadInstructions } from '@cv-tailor/contracts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StoredDocument } from '../../../src/data/documents.ts';
import type { CreateResult } from '../../../src/documents/service.ts';
import {
  type CreateDependencies,
  createHandler,
  handler,
} from '../../../src/handlers/documents/create.ts';
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

// POST /documents (S3-07). The rules behind each outcome are tested in documents/service.test.ts.
// This tests the HTTP side: who may call, the body, the status codes, and the logs.

// create.ts reads its settings when it loads. vi.hoisted runs before the imports above.
vi.hoisted(() => {
  process.env.TABLE_NAME = 'cv-tailor-test-data';
  process.env.BUCKET_NAME = 'cv-tailor-test-documents';
  process.env.ALLOWED_ORIGIN = 'https://dev.cv.ikiwii.com';
});

const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';
const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const REQUEST = { name: 'Résumé 2026.pdf', type: 'pdf', size: 1_000, sha256: SHA256 };
const DOCUMENT: StoredDocument = {
  id: DOC_ID,
  name: 'Résumé 2026.pdf',
  type: 'pdf',
  size: 1_000,
  sha256: SHA256,
  objectKey: `kb/${SUB}/${DOC_ID}.pdf`,
  uploadState: 'RESERVED',
  uploadDeadline: '2026-10-07T10:15:00.000Z',
  createdAt: '2026-10-07T09:15:00.000Z',
};
const UPLOAD: UploadInstructions = {
  method: 'PUT',
  url: `https://cv-tailor-test-documents.s3.us-east-1.amazonaws.com/kb/${SUB}/${DOC_ID}.pdf?X-Amz-Expires=300`,
  headers: {
    'content-type': 'application/pdf',
    'x-amz-checksum-sha256': 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
  },
  expiresAt: '2026-10-07T09:20:00.000Z',
};
const SUMMARY = {
  id: DOC_ID,
  name: 'Résumé 2026.pdf',
  type: 'pdf',
  size: 1_000,
  status: 'UPLOADING',
  createdAt: '2026-10-07T09:15:00.000Z',
};

const setup = (result: CreateResult | Error) => {
  const create = vi.fn<CreateDependencies['create']>(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return { create, run: createHandler({ create, allowedOrigin: ORIGIN, now: () => AT }) };
};
const post = (body: unknown = REQUEST) =>
  adminToken({ body: typeof body === 'string' ? body : JSON.stringify(body) });

let logged: () => unknown[];
beforeEach(() => {
  logged = captureLogs();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /documents', () => {
  test('a new file: 201, the document, and the upload instructions', async () => {
    const { create, run } = setup({ outcome: 'created', document: DOCUMENT, upload: UPLOAD });

    const result = await run(post());

    expect(result.statusCode).toBe(201);
    expect(result.headers).toEqual(JSON_HEADERS);
    expect(JSON.parse(result.body)).toEqual({
      outcome: 'created',
      document: SUMMARY,
      upload: UPLOAD,
    });
    expect(create).toHaveBeenCalledWith(SUB, REQUEST);
    expect(logged()).toEqual([{ route: 'POST /documents', outcome: 'created', durationMs: 0 }]);
  });

  test('a retry of a file still uploading: 200, with new upload instructions', async () => {
    const { run } = setup({ outcome: 'resumed', document: DOCUMENT, upload: UPLOAD });

    const result = await run(post());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      outcome: 'resumed',
      document: SUMMARY,
      upload: UPLOAD,
    });
  });

  test('the same content again: 200, and no upload', async () => {
    const stored = { ...DOCUMENT, uploadState: 'UPLOADED' as const };
    const { run } = setup({ outcome: 'unchanged', document: stored });

    const result = await run(post());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      outcome: 'unchanged',
      document: { ...SUMMARY, status: 'PENDING' },
    });
  });

  test.each(['storage-full', 'too-many-documents', 'conflict'] as const)(
    '%s: 409 with its code',
    async (outcome) => {
      const { run } = setup({ outcome });

      const result = await run(post());

      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body)).toMatchObject({ code: outcome });
      expect(logged()).toEqual([{ route: 'POST /documents', outcome, durationMs: 0 }]);
    },
  );
});

describe('refuses before any work', () => {
  // Sprint 3 risk table: uploads are for the admin group until the quota exists (Sprint 6).
  test('a caller outside the admin group: 403', async () => {
    const { create, run } = setup({ outcome: 'conflict' });

    const result = await run(accessToken({ body: JSON.stringify(REQUEST) }));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body)).toMatchObject({ code: 'forbidden' });
    expect(create).not.toHaveBeenCalled();
    expect(logged()).toEqual([{ route: 'POST /documents', outcome: 'forbidden', durationMs: 0 }]);
  });

  test.each<[string, unknown, string]>([
    ['a body that is not JSON', '{"name":', 'invalid-request'],
    ['a type not allowed', { ...REQUEST, name: 'run.exe', type: 'exe' }, 'type-not-allowed'],
    ['one byte over 50 MB', { ...REQUEST, size: 50_000_001 }, 'too-large'],
  ])('%s: 400 %s', async (_, body, code) => {
    const { create, run } = setup({ outcome: 'conflict' });

    const result = await run(post(body));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ code });
    expect(create).not.toHaveBeenCalled();
  });

  test('a request without claims: 500, and no work', async () => {
    const { create, run } = setup({ outcome: 'conflict' });

    const result = await run(eventWith(undefined, { body: JSON.stringify(REQUEST) }));

    expect(result.statusCode).toBe(500);
    expect(create).not.toHaveBeenCalled();
    expect(logged()).toEqual([{ route: 'POST /documents', outcome: 'no-claims', durationMs: 0 }]);
  });
});

describe('failures', () => {
  test('an AWS error: 500 with no detail, and only its name in the log', async () => {
    const failure = Object.assign(new Error(`Throttled on USER#${SUB}`), {
      name: 'ThrottlingException',
    });
    const { run } = setup(failure);

    const result = await run(post());

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ message: 'Internal server error' });
    expect(logged()).toEqual([
      { route: 'POST /documents', outcome: 'error', error: 'ThrottlingException', durationMs: 0 },
    ]);
  });

  // The contract is checked before sending, so a bug can't send a wrong body.
  test('a response that breaks the contract is never sent', async () => {
    const { run } = setup({
      outcome: 'created',
      document: DOCUMENT,
      upload: { ...UPLOAD, url: 'not a url' },
    });

    const result = await run(post());

    expect(result.statusCode).toBe(500);
    expect(logged()).toEqual([
      { route: 'POST /documents', outcome: 'error', error: 'ZodError', durationMs: 0 },
    ]);
  });
});

// SAFE-04: no log line holds the sub, the file name, the hash, the document ID, or the URL.
test('never logs the sub, the file, or the upload URL', async () => {
  await setup({ outcome: 'created', document: DOCUMENT, upload: UPLOAD }).run(post());
  await setup(new Error(SUB)).run(post());

  const text = JSON.stringify(logged());
  for (const secret of [SUB, 'Résumé', SHA256, DOC_ID, 'X-Amz']) {
    expect(text).not.toContain(secret);
  }
});

test('the deployed handler is built from the environment settings', () => {
  expect(handler).toBeTypeOf('function');
});

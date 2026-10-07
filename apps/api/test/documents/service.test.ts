import type { CreateDocumentRequest, UploadInstructions } from '@cv-tailor/contracts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  DocumentStore,
  RemoveOutcome,
  StorageUsage,
  StoredDocument,
} from '../../src/data/documents.ts';
import { isId } from '../../src/data/keys.ts';
import {
  createDocument,
  deleteDocument,
  listDocuments,
  reconcile,
  RESERVATION_SECONDS,
  type ServiceDeps,
} from '../../src/documents/service.ts';
import type { DocumentBucket } from '../../src/storage/documents-bucket.ts';
import { aclObjectKey, userObjectPrefix } from '../../src/storage/keys.ts';

// The document rules (S3-07), end to end against an in-memory table and bucket. The fake table
// applies the same conditions as the real store (data/documents.ts), whose exact requests
// test/data/documents.test.ts pins. Both fakes write every step to one log, so a test can check
// the order across them.

const A = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const B = '0f8fad5b-d9cb-469f-a165-70867728950e';
const T0 = new Date('2026-10-07T09:00:00.000Z');
const HOUR = RESERVATION_SECONDS * 1000;
const LIMITS = { maxBytes: 50_000_000, maxDocuments: 100 };
const NO_USAGE: StorageUsage = { usedBytes: 0, documentCount: 0 };

// A distinct, valid SHA-256 (64 lowercase hex characters) for each n.
const hash = (n: number): string => n.toString(16).padStart(64, '0');
const request = (overrides: Partial<CreateDocumentRequest> = {}): CreateDocumentRequest => ({
  name: 'cv.pdf',
  type: 'pdf',
  size: 1_000,
  sha256: hash(1),
  ...overrides,
});

interface FakeOptions {
  readonly reserveConflicts?: number; // the first n reserves return 'conflict'
  readonly removeConflicts?: number; // the first n removes return 'conflict'
}

// The data table, per sub. The same conditions as data/documents.ts.
function fakeStore(log: string[], { reserveConflicts = 0, removeConflicts = 0 }: FakeOptions) {
  const items = new Map<string, StoredDocument>(); // `${sub}/${id}`
  const usage = new Map<string, StorageUsage>();
  const at = (sub: string, id: string) => `${sub}/${id}`;
  const usageOf = (sub: string): StorageUsage => usage.get(sub) ?? NO_USAGE;
  let reserveConflictsLeft = reserveConflicts;
  let removeConflictsLeft = removeConflicts;

  const store: DocumentStore = {
    list: (sub) => {
      log.push('list');
      return Promise.resolve(
        [...items].filter(([key]) => key.startsWith(`${sub}/`)).map(([, document]) => document),
      );
    },
    get: (sub, id) => {
      log.push('get');
      return Promise.resolve(items.get(at(sub, id)));
    },
    usage: (sub) => {
      log.push('usage');
      return Promise.resolve(usageOf(sub));
    },
    reserve: (sub, document, { maxBytes, maxDocuments }) => {
      log.push('reserve');
      if (reserveConflictsLeft > 0) {
        reserveConflictsLeft--;
        return Promise.resolve('conflict');
      }
      const { usedBytes, documentCount } = usageOf(sub);
      // The real condition: usedBytes <= maxBytes - size AND documentCount < maxDocuments.
      if (usedBytes > maxBytes - document.size || documentCount >= maxDocuments) {
        return Promise.resolve(
          documentCount >= maxDocuments ? 'too-many-documents' : 'storage-full',
        );
      }
      items.set(at(sub, document.id), document);
      usage.set(sub, { usedBytes: usedBytes + document.size, documentCount: documentCount + 1 });
      return Promise.resolve('reserved');
    },
    markUploaded: (sub, id) => {
      log.push('markUploaded');
      const document = items.get(at(sub, id));
      if (document?.uploadState === 'RESERVED') {
        items.set(at(sub, id), { ...document, uploadState: 'UPLOADED' });
      }
      return Promise.resolve();
    },
    extendDeadline: (sub, id, deadline) => {
      log.push('extendDeadline');
      const document = items.get(at(sub, id));
      if (document?.uploadState !== 'RESERVED') return Promise.resolve(false);
      items.set(at(sub, id), { ...document, uploadDeadline: deadline });
      return Promise.resolve(true);
    },
    remove: (sub, document, onlyIfReserved) => {
      log.push(onlyIfReserved ? 'release' : 'remove');
      if (removeConflictsLeft > 0) {
        removeConflictsLeft--;
        return Promise.resolve('conflict');
      }
      const current = items.get(at(sub, document.id));
      if (!current || (onlyIfReserved && current.uploadState !== 'RESERVED')) {
        return Promise.resolve('gone');
      }
      items.delete(at(sub, document.id));
      const { usedBytes, documentCount } = usageOf(sub);
      usage.set(sub, { usedBytes: usedBytes - document.size, documentCount: documentCount - 1 });
      return Promise.resolve('removed');
    },
  };
  return { store, items, usage, usageOf };
}

// The documents bucket: a set of keys.
function fakeBucket(log: string[]) {
  const objects = new Set<string>();
  const bucket: DocumentBucket = {
    putAcl: (_sub, documentKey) => {
      log.push(`putAcl ${documentKey}`);
      objects.add(aclObjectKey(documentKey));
      return Promise.resolve();
    },
    presignUpload: (documentKey, type, size, sha256Hex, now) => {
      log.push(`presign ${documentKey}`);
      const upload: UploadInstructions = {
        method: 'PUT',
        url: `https://documents.example/${documentKey}`,
        headers: {
          'content-type': `test/${type}`,
          'x-amz-checksum-sha256': `${sha256Hex}:${size}`,
        },
        expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      };
      return Promise.resolve(upload);
    },
    listObjectKeys: (sub) => {
      log.push(`listObjects ${sub}`);
      return Promise.resolve(
        new Set([...objects].filter((key) => key.startsWith(userObjectPrefix(sub)))),
      );
    },
    deleteObject: (key) => {
      log.push(`deleteObject ${key}`);
      objects.delete(key);
      return Promise.resolve();
    },
  };
  return { bucket, objects };
}

function setup(options: FakeOptions = {}) {
  const log: string[] = [];
  const table = fakeStore(log, options);
  const { bucket, objects } = fakeBucket(log);
  const sleeps: number[] = [];
  let now = T0;
  const deps: ServiceDeps = {
    store: table.store,
    bucket,
    limits: LIMITS,
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
  return {
    ...table,
    deps,
    log,
    objects,
    sleeps,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    // The browser's PUT to the presigned URL.
    upload: (document: StoredDocument) => {
      objects.add(document.objectKey);
    },
  };
}
type Env = ReturnType<typeof setup>;

// POST /documents for a new file. Fails the test on any other outcome.
async function created(env: Env, sub: string, overrides: Partial<CreateDocumentRequest> = {}) {
  const result = await createDocument(env.deps, sub, request(overrides));
  if (result.outcome !== 'created') throw new Error(`Expected created, got ${result.outcome}`);
  return result.document;
}

// POST /documents, the browser's upload, then a GET that sees it arrive.
async function uploaded(env: Env, sub: string, overrides: Partial<CreateDocumentRequest> = {}) {
  const document = await created(env, sub, overrides);
  env.upload(document);
  await listDocuments(env.deps, sub);
  return { ...document, uploadState: 'UPLOADED' as const };
}

describe('createDocument', () => {
  test('reserves the bytes, writes the ACL file, then returns an upload URL', async () => {
    const env = setup();

    const result = await createDocument(env.deps, A, request());

    if (result.outcome !== 'created') throw new Error(result.outcome);
    const { document } = result;
    expect(isId(document.id)).toBe(true);
    expect(document).toEqual({
      id: document.id,
      name: 'cv.pdf',
      type: 'pdf',
      size: 1_000,
      sha256: hash(1),
      objectKey: `kb/${A}/${document.id}.pdf`,
      uploadState: 'RESERVED',
      uploadDeadline: '2026-10-07T10:00:00.000Z',
      createdAt: '2026-10-07T09:00:00.000Z',
    });
    expect(result.upload.url).toBe(`https://documents.example/kb/${A}/${document.id}.pdf`);
    expect(env.usageOf(A)).toEqual({ usedBytes: 1_000, documentCount: 1 });
    // The ACL file goes before the URL, so the document can never arrive without it (ADR-0007).
    expect(env.log).toEqual([
      'list',
      'reserve',
      `putAcl ${document.objectKey}`,
      `presign ${document.objectKey}`,
    ]);
  });

  // Uploading the same content again would re-index it (S2-12).
  test('the same content already stored is unchanged: no reservation, no write', async () => {
    const env = setup();
    const first = await uploaded(env, A);
    env.log.length = 0;

    const again = await createDocument(env.deps, A, request({ name: 'renamed.pdf' }));

    expect(again).toEqual({ outcome: 'unchanged', document: first });
    expect(env.usageOf(A)).toEqual({ usedBytes: 1_000, documentCount: 1 });
    expect(env.log).toEqual(['list']);
  });

  // A retry after a failed upload reuses the reservation: the bytes aren't counted twice, and the
  // candidate isn't blocked for an hour.
  test('the same file still uploading is resumed: same reservation, new deadline, new URL', async () => {
    const env = setup();
    const first = await created(env, A);
    env.advance(10 * 60_000);
    env.log.length = 0;

    const again = await createDocument(env.deps, A, request());

    if (again.outcome !== 'resumed') throw new Error(again.outcome);
    expect(again.document).toEqual({ ...first, uploadDeadline: '2026-10-07T10:10:00.000Z' });
    expect(env.items.get(`${A}/${first.id}`)?.uploadDeadline).toBe('2026-10-07T10:10:00.000Z');
    expect(env.usageOf(A)).toEqual({ usedBytes: 1_000, documentCount: 1 });
    expect(env.log).toEqual([
      'list',
      `listObjects ${A}`,
      'extendDeadline',
      `putAcl ${first.objectKey}`, // again, in case the first attempt failed before writing it
      `presign ${first.objectKey}`,
    ]);
  });

  test('a resume that loses a race to an upload or a delete reports a conflict', async () => {
    const env = setup();
    await created(env, A);
    const store = { ...env.store, extendDeadline: () => Promise.resolve(false) };

    await expect(createDocument({ ...env.deps, store }, A, request())).resolves.toEqual({
      outcome: 'conflict',
    });
  });

  // The bytes are reserved but no URL was given, so the file can't arrive. The lazy release frees
  // them after the deadline.
  test('if the ACL write fails, the reservation is released after its deadline', async () => {
    const env = setup();
    const failure = new Error('S3 unavailable');
    const bucket = { ...env.deps.bucket, putAcl: () => Promise.reject(failure) };

    await expect(createDocument({ ...env.deps, bucket }, A, request())).rejects.toBe(failure);
    expect(env.usageOf(A)).toEqual({ usedBytes: 1_000, documentCount: 1 });

    env.advance(HOUR + 1);
    await expect(listDocuments(env.deps, A)).resolves.toEqual({ documents: [], usage: NO_USAGE });
  });
});

describe('the 50 MB cap and 100 documents (KB-06)', () => {
  test('a file that fills the cap exactly is accepted', async () => {
    const env = setup();
    env.usage.set(A, { usedBytes: 49_999_000, documentCount: 3 });

    await expect(createDocument(env.deps, A, request({ size: 1_000 }))).resolves.toMatchObject({
      outcome: 'created',
    });
    expect(env.usageOf(A)).toEqual({ usedBytes: 50_000_000, documentCount: 4 });
  });

  test('one byte over is refused, and nothing is written', async () => {
    const env = setup();
    env.usage.set(A, { usedBytes: 49_999_000, documentCount: 3 });

    await expect(createDocument(env.deps, A, request({ size: 1_001 }))).resolves.toEqual({
      outcome: 'storage-full',
    });
    expect(env.usageOf(A)).toEqual({ usedBytes: 49_999_000, documentCount: 3 });
    expect(env.objects.size).toBe(0);
    expect(env.log).toEqual(['list', 'reserve']);
  });

  test('the 101st document is refused', async () => {
    const env = setup();
    env.usage.set(A, { usedBytes: 5_000, documentCount: 100 });

    await expect(createDocument(env.deps, A, request())).resolves.toEqual({
      outcome: 'too-many-documents',
    });
  });

  test("another user's full knowledge base doesn't count against this one", async () => {
    const env = setup();
    env.usage.set(B, { usedBytes: 50_000_000, documentCount: 100 });

    await expect(createDocument(env.deps, A, request())).resolves.toMatchObject({
      outcome: 'created',
    });
  });
});

describe('a conflict with another write by the same user', () => {
  test('is retried with growing waits, then succeeds', async () => {
    const env = setup({ reserveConflicts: 2 });

    await expect(createDocument(env.deps, A, request())).resolves.toMatchObject({
      outcome: 'created',
    });
    expect(env.log.filter((step) => step === 'reserve')).toHaveLength(3);
    // attempt × 50 ms, plus up to 50 ms of jitter
    expect(env.sleeps).toHaveLength(2);
    expect(env.sleeps[0]).toBeGreaterThanOrEqual(50);
    expect(env.sleeps[0]).toBeLessThan(100);
    expect(env.sleeps[1]).toBeGreaterThanOrEqual(100);
    expect(env.sleeps[1]).toBeLessThan(150);
  });

  test('gives up after 3 attempts, and writes no ACL file', async () => {
    const env = setup({ reserveConflicts: 3 });

    await expect(createDocument(env.deps, A, request())).resolves.toEqual({ outcome: 'conflict' });
    expect(env.log).toEqual(['list', 'reserve', 'reserve', 'reserve']);
    expect(env.sleeps).toHaveLength(2); // no wait after the last attempt
  });

  describe('without a sleep function', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test('waits on a real timer', async () => {
      vi.useFakeTimers();
      const env = setup({ reserveConflicts: 1 });
      const deps: ServiceDeps = {
        store: env.deps.store,
        bucket: env.deps.bucket,
        limits: LIMITS,
        now: env.deps.now,
      };

      const pending = createDocument(deps, A, request());
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ outcome: 'created' });
    });
  });
});

describe('the lazy release (runs in POST and GET)', () => {
  test('without a reserved document, it never lists the bucket', async () => {
    const env = setup();
    const documents = [await uploaded(env, A)];
    env.log.length = 0;

    await expect(reconcile(env.deps, A, documents)).resolves.toBe(documents);
    expect(env.log).toEqual([]);
  });

  test('an upload that arrived is marked UPLOADED', async () => {
    const env = setup();
    const document = await created(env, A);
    env.upload(document);
    env.log.length = 0;

    const { documents } = await listDocuments(env.deps, A);

    expect(documents).toEqual([{ ...document, uploadState: 'UPLOADED' }]);
    expect(env.items.get(`${A}/${document.id}`)?.uploadState).toBe('UPLOADED');
    expect(env.log).toEqual(['list', `listObjects ${A}`, 'markUploaded', 'usage']);
  });

  test.each([
    ['10 minutes', 10 * 60_000],
    ['exactly 1 hour, the deadline', HOUR],
  ])('an upload still missing after %s is kept, with its bytes', async (_, elapsed) => {
    const env = setup();
    const document = await created(env, A);
    env.advance(elapsed);

    await expect(listDocuments(env.deps, A)).resolves.toEqual({
      documents: [document],
      usage: { usedBytes: 1_000, documentCount: 1 },
    });
  });

  test('1 ms after the deadline it is released: ACL file deleted, bytes freed', async () => {
    const env = setup();
    const document = await created(env, A);
    env.advance(HOUR + 1);
    env.log.length = 0;

    await expect(listDocuments(env.deps, A)).resolves.toEqual({ documents: [], usage: NO_USAGE });
    expect(env.objects.size).toBe(0);
    expect(env.items.size).toBe(0);
    expect(env.log).toEqual([
      'list',
      `listObjects ${A}`,
      `deleteObject ${aclObjectKey(document.objectKey)}`,
      'release',
      'usage',
    ]);
  });

  // Two GETs at once both find the stale reservation. The second release changes nothing.
  test('a release another request already did is fine', async () => {
    const env = setup();
    await created(env, A);
    env.advance(HOUR + 1);
    const store = { ...env.store, remove: (): Promise<RemoveOutcome> => Promise.resolve('gone') };

    await expect(listDocuments({ ...env.deps, store }, A)).resolves.toMatchObject({
      documents: [],
    });
  });
});

describe('listDocuments', () => {
  test("returns the caller's documents and their usage", async () => {
    const env = setup();
    const pdf = await uploaded(env, A);
    const notes = await uploaded(env, A, { name: 'notes.md', type: 'md', sha256: hash(2) });

    const { documents, usage } = await listDocuments(env.deps, A);

    expect(documents).toHaveLength(2);
    expect(documents).toEqual(expect.arrayContaining([pdf, notes]));
    expect(usage).toEqual({ usedBytes: 2_000, documentCount: 2 });
  });
});

describe('deleteDocument', () => {
  test('deletes the document, then its ACL file, then the item, and frees the bytes', async () => {
    const env = setup();
    const document = await uploaded(env, A);
    env.log.length = 0;

    await expect(deleteDocument(env.deps, A, document.id)).resolves.toBe('deleted');
    // Document first: it is never in the bucket without its ACL file. Item last: a retry after a
    // failure still finds it and finishes the job.
    expect(env.log).toEqual([
      'get',
      `deleteObject ${document.objectKey}`,
      `deleteObject ${aclObjectKey(document.objectKey)}`,
      'remove',
    ]);
    expect(env.objects.size).toBe(0);
    expect(env.items.size).toBe(0);
    expect(env.usageOf(A)).toEqual(NO_USAGE);
  });

  // Its URL may still be live: the file could arrive after its ACL file is gone.
  test('a document still uploading is refused, and nothing is touched', async () => {
    const env = setup();
    const document = await created(env, A);
    env.log.length = 0;

    await expect(deleteDocument(env.deps, A, document.id)).resolves.toBe('upload-in-progress');
    expect(env.log).toEqual(['get']);
  });

  test('a reservation past its deadline can be deleted', async () => {
    const env = setup();
    const document = await created(env, A);
    env.advance(HOUR + 1);

    await expect(deleteDocument(env.deps, A, document.id)).resolves.toBe('deleted');
    expect(env.usageOf(A)).toEqual(NO_USAGE);
  });

  test.each([
    ['empty', ''],
    ['not a UUID', 'abc'],
    ['a path', '../019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b'],
    ['a UUID v4', '7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    ['capital letters', '019AB3C4-5D6E-7F80-9A1B-2C3D4E5F6A7B'],
  ])('a malformed ID (%s) is not found, without reading the table', async (_, id) => {
    const env = setup();

    await expect(deleteDocument(env.deps, A, id)).resolves.toBe('not-found');
    expect(env.log).toEqual([]);
  });

  test('an unknown ID is not found', async () => {
    const env = setup();

    await expect(deleteDocument(env.deps, A, '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b')).resolves.toBe(
      'not-found',
    );
    expect(env.log).toEqual(['get']);
  });

  test('a parallel delete that got there first still counts as deleted', async () => {
    const env = setup();
    const document = await uploaded(env, A);
    const store = { ...env.store, remove: (): Promise<RemoveOutcome> => Promise.resolve('gone') };

    await expect(deleteDocument({ ...env.deps, store }, A, document.id)).resolves.toBe('deleted');
  });

  test('a conflict is retried 3 times, then reported', async () => {
    const env = setup({ removeConflicts: 3 });
    const document = await uploaded(env, A);

    await expect(deleteDocument(env.deps, A, document.id)).resolves.toBe('conflict');
    expect(env.log.filter((step) => step === 'remove')).toHaveLength(3);
  });
});

describe("isolation (S3-07: user A can't list or delete user B's documents)", () => {
  test("A lists only A's documents and A's usage", async () => {
    const env = setup();
    await uploaded(env, B);

    await expect(listDocuments(env.deps, A)).resolves.toEqual({ documents: [], usage: NO_USAGE });
  });

  test("A deleting B's document ID gets not-found, and B's document, ACL file, and bytes stay", async () => {
    const env = setup();
    const theirs = await uploaded(env, B);
    env.log.length = 0;

    await expect(deleteDocument(env.deps, A, theirs.id)).resolves.toBe('not-found');
    expect(env.log).toEqual(['get']);
    expect(env.objects).toEqual(new Set([theirs.objectKey, aclObjectKey(theirs.objectKey)]));
    expect(env.items.get(`${B}/${theirs.id}`)).toEqual(theirs);
    expect(env.usageOf(B)).toEqual({ usedBytes: 1_000, documentCount: 1 });
  });

  // A's GET lists only A's prefix, so it never sees, marks, or releases B's reservation.
  test("A's lazy release never touches B's reservation", async () => {
    const env = setup();
    const theirs = await created(env, B);
    await created(env, A, { sha256: hash(2) });
    env.advance(HOUR + 1);
    env.log.length = 0;

    await listDocuments(env.deps, A);

    expect(env.log).toContain(`listObjects ${A}`);
    expect(env.log).not.toContain(`listObjects ${B}`);
    expect(env.items.get(`${B}/${theirs.id}`)).toEqual(theirs);
    expect(env.usageOf(B)).toEqual({ usedBytes: 1_000, documentCount: 1 });
  });

  // Skipping duplicates across users would tell A that B stores the same file.
  test("B's copy of the same file doesn't make A's upload unchanged", async () => {
    const env = setup();
    await uploaded(env, B);

    await expect(createDocument(env.deps, A, request())).resolves.toMatchObject({
      outcome: 'created',
    });
  });
});

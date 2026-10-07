import { expect, test } from 'vitest';
import { documentDependencies } from '../../../src/handlers/documents/dependencies.ts';

// What the document Lambdas build when they load (S3-07). No AWS call: the clients connect on
// their first request.

const ENV = { TABLE_NAME: 'cv-tailor-test-data', BUCKET_NAME: 'cv-tailor-test-documents' };

test('uses the KB-06 limits, the same for every candidate', () => {
  expect(documentDependencies(ENV).limits).toEqual({ maxBytes: 50_000_000, maxDocuments: 100 });
});

test('builds a store and a bucket', () => {
  const { store, bucket } = documentDependencies(ENV);

  expect(Object.keys(store).sort()).toEqual([
    'extendDeadline',
    'get',
    'list',
    'markUploaded',
    'remove',
    'reserve',
    'usage',
  ]);
  expect(Object.keys(bucket).sort()).toEqual([
    'deleteObject',
    'listObjectKeys',
    'presignUpload',
    'putAcl',
  ]);
});

test('reads the real time', () => {
  const before = Date.now();
  const now = documentDependencies(ENV).now().getTime();

  expect(now).toBeGreaterThanOrEqual(before);
  expect(now).toBeLessThanOrEqual(Date.now());
});

// env.ts: a missing setting fails when the module loads, not halfway through a request.
test.each(['TABLE_NAME', 'BUCKET_NAME'])('refuses to start without %s', (name) => {
  const env: Record<string, string | undefined> = { ...ENV, [name]: undefined };

  expect(() => documentDependencies(env)).toThrow(`Missing environment variable ${name}`);
});

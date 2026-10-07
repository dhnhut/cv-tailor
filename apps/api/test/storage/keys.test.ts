import { describe, expect, test } from 'vitest';
import { DOCUMENT_TYPES, type DocumentType } from '@cv-tailor/contracts';
import { aclObjectKey, documentObjectKey, userObjectPrefix } from '../../src/storage/keys.ts';

// S3 keys in the documents bucket (S3-07, ADR-0007). Written out literally, so a changed layout
// fails here: S3-08 maps ingestion's s3://<bucket>/<key> back to a document with this layout.

const SUB = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b'; // a UUID v7

describe('the key layout', () => {
  test("a user's prefix", () => {
    expect(userObjectPrefix(SUB)).toBe(`kb/${SUB}/`);
  });

  test.each(DOCUMENT_TYPES)('a .%s document', (type) => {
    expect(documentObjectKey(SUB, DOC_ID, type)).toBe(`kb/${SUB}/${DOC_ID}.${type}`);
  });

  test('the ACL file sits next to its document', () => {
    expect(aclObjectKey(`kb/${SUB}/${DOC_ID}.pdf`)).toBe(`kb/${SUB}/${DOC_ID}.pdf.metadata.json`);
  });

  // S3-08 starts a sync for a document's event, not for its ACL file's, and tells them apart
  // by this suffix.
  test.each(DOCUMENT_TYPES)('a .%s document key never looks like an ACL file', (type) => {
    expect(documentObjectKey(SUB, DOC_ID, type).endsWith('.metadata.json')).toBe(false);
  });
});

// The lazy release lists one user's prefix (ListObjectsV2). It must never see another user's keys.
test("one user's prefix never covers another user's document or ACL file", () => {
  const theirs = documentObjectKey(OTHER_SUB, DOC_ID, 'pdf');
  expect(theirs.startsWith(userObjectPrefix(SUB))).toBe(false);
  expect(aclObjectKey(theirs).startsWith(userObjectPrefix(SUB))).toBe(false);
});

// The same rule as data/keys.ts: each regex matches the whole message, so a refused value never
// appears in it. Lambda logs thrown messages (S2-07, SAFE-04).
describe('refuses a bad key part, and never repeats it in the error', () => {
  test.each([
    ['empty', ''],
    ['an email address', 'alice@example.com'],
    ['capital letters', SUB.toUpperCase()],
    ['a path', `../${SUB}`],
    ['a slash inside', `${SUB}/x`],
  ])('sub: %s', (_, sub) => {
    expect(() => userObjectPrefix(sub)).toThrow(/^Invalid sub for a documents bucket key$/);
    expect(() => documentObjectKey(sub, DOC_ID, 'pdf')).toThrow(
      /^Invalid sub for a documents bucket key$/,
    );
  });

  test.each([
    ['empty', ''],
    ['a UUID v4', '7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    ['capital letters', DOC_ID.toUpperCase()],
    ['a path', `../${DOC_ID}`],
    ['a slash inside', `${DOC_ID}/x`],
  ])('document ID: %s', (_, id) => {
    expect(() => documentObjectKey(SUB, id, 'pdf')).toThrow(
      /^Invalid document ID for a documents bucket key$/,
    );
  });

  // TypeScript's DocumentType vanishes at runtime. A type read from DynamoDB is only cast.
  test.each([
    ['empty', ''],
    ['an executable', 'exe'],
    ['capital letters', 'PDF'],
    ['a path', 'pdf/../../other'],
  ])('type: %s', (_, type) => {
    expect(() => documentObjectKey(SUB, DOC_ID, type as DocumentType)).toThrow(
      /^Invalid type for a documents bucket key$/,
    );
  });
});

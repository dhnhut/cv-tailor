import { DocumentSummary } from '@cv-tailor/contracts';
import { expect, test } from 'vitest';
import type { StoredDocument, UploadState } from '../../../src/data/documents.ts';
import { summary } from '../../../src/handlers/documents/summary.ts';

// A stored document as the API shows it (S3-07).

const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';

const stored = (uploadState: UploadState): StoredDocument => ({
  id: DOC_ID,
  name: 'Résumé 2026.pdf',
  type: 'pdf',
  size: 1_000,
  sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  objectKey: `kb/${SUB}/${DOC_ID}.pdf`,
  uploadState,
  uploadDeadline: '2026-10-07T10:00:00.000Z',
  createdAt: '2026-10-07T09:00:00.000Z',
});

// An exact match: the hash, the S3 key, and the deadline stay in the API.
test.each<[UploadState, string]>([
  ['RESERVED', 'UPLOADING'],
  ['UPLOADED', 'PENDING'], // until S3-08 reads the ingestion status
])('a %s document shows as %s, with no internal fields', (uploadState, status) => {
  const result = summary(stored(uploadState));

  expect(result).toEqual({
    id: DOC_ID,
    name: 'Résumé 2026.pdf',
    type: 'pdf',
    size: 1_000,
    status,
    createdAt: '2026-10-07T09:00:00.000Z',
  });
  expect(DocumentSummary.parse(result)).toEqual(result);
});

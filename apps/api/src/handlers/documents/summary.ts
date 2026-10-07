import type { DocumentSummary } from '@cv-tailor/contracts';
import type { StoredDocument } from '../../data/documents.ts';

// A stored document as the API shows it (S3-07). The hash and the S3 key stay in the API, and
// DocumentSummary is a strict object, so a handler's parse would refuse them.
// UPLOADING until the file is in S3, then PENDING until S3-08 reads the ingestion status.
export const summary = (document: StoredDocument): DocumentSummary => ({
  id: document.id,
  name: document.name,
  type: document.type,
  size: document.size,
  status: document.uploadState === 'RESERVED' ? 'UPLOADING' : 'PENDING',
  createdAt: document.createdAt,
});

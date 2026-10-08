import { MAX_DOCUMENTS, STORAGE_LIMIT_BYTES } from '@cv-tailor/contracts';
import { dynamoClient, s3Client } from '../../aws.ts';
import { dynamoDocumentStore } from '../../data/documents.ts';
import type { ServiceDeps } from '../../documents/service.ts';
import { requiredEnv } from '../../env.ts';
import { s3DocumentBucket } from '../../storage/documents-bucket.ts';

// What the three document Lambdas need, built from the settings infra/modules/api gives them. Each
// handler calls this when its module loads, so a missing setting fails the first request loudly
// (env.ts). The environment is a parameter so a test can pass its own.
export const documentDependencies = (
  env: Record<string, string | undefined> = process.env,
): ServiceDeps => ({
  store: dynamoDocumentStore(dynamoClient(), requiredEnv('TABLE_NAME', env)),
  bucket: s3DocumentBucket(s3Client(), requiredEnv('BUCKET_NAME', env)),
  // KB-06. The same for every candidate until an admin can change it (ADMIN-02, Sprint 6).
  limits: { maxBytes: STORAGE_LIMIT_BYTES, maxDocuments: MAX_DOCUMENTS },
  now: () => new Date(),
});

import type { CreateDocumentRequest, UploadInstructions } from '@cv-tailor/contracts';
import { isId, newId } from '../data/keys.ts';
import type {
  DocumentStore,
  Limits,
  RemoveOutcome,
  ReserveOutcome,
  StorageUsage,
  StoredDocument,
} from '../data/documents.ts';
import type { DocumentBucket } from '../storage/documents-bucket.ts';
import { aclObjectKey, documentObjectKey } from '../storage/keys.ts';

// How long a reservation waits for its file before it's released (S3-07). Well past the URL's
// 5 minutes, so a slow 50 MB upload that started in time isn't released while it's arriving.
export const RESERVATION_SECONDS = 3600;
const CONFLICT_ATTEMPTS = 3;

export interface ServiceDeps {
  readonly store: DocumentStore;
  readonly bucket: DocumentBucket;
  readonly limits: Limits;
  readonly now: () => Date;
  readonly sleep?: (ms: number) => Promise<void>; // tests pass a no-op
}

// Two writes to the same user's STORAGE item at once cancel one transaction with
// TransactionConflict. Retry a few times with jitter. The SDK doesn't retry these.
async function retryOnConflict<T extends string>(
  deps: ServiceDeps,
  write: () => Promise<T>,
): Promise<T> {
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    const outcome = await write();
    if (outcome !== 'conflict' || attempt === CONFLICT_ATTEMPTS) return outcome;
    await sleep(attempt * 50 + Math.random() * 50);
  }
}

// The lazy release (S3-07 details item 3). Runs in POST and GET. Costs nothing without a
// RESERVED item, and one ListObjectsV2 on the caller's prefix otherwise.
export async function reconcile(
  deps: ServiceDeps,
  sub: string,
  documents: StoredDocument[],
): Promise<StoredDocument[]> {
  if (!documents.some((d) => d.uploadState === 'RESERVED')) return documents;
  const inBucket = await deps.bucket.listObjectKeys(sub);
  const now = deps.now().getTime();
  const kept: StoredDocument[] = [];
  for (const d of documents) {
    if (d.uploadState === 'UPLOADED') kept.push(d);
    else if (inBucket.has(d.objectKey)) {
      await deps.store.markUploaded(sub, d.id);
      kept.push({ ...d, uploadState: 'UPLOADED' });
    } else if (now > Date.parse(d.uploadDeadline)) {
      // Its URL expired long ago, so the file can't arrive any more. Free its bytes.
      await deps.bucket.deleteObject(aclObjectKey(d.objectKey));
      await retryOnConflict(deps, () => deps.store.remove(sub, d, true)); // 'gone': another request released it
    } else kept.push(d); // still uploading
  }
  return kept;
}

export type CreateResult =
  | { outcome: 'created' | 'resumed'; document: StoredDocument; upload: UploadInstructions }
  | { outcome: 'unchanged'; document: StoredDocument }
  | { outcome: Exclude<ReserveOutcome, 'reserved'> };

export async function createDocument(
  deps: ServiceDeps,
  sub: string,
  request: CreateDocumentRequest,
): Promise<CreateResult> {
  const documents = await reconcile(deps, sub, await deps.store.list(sub));
  const now = deps.now();
  const deadline = new Date(now.getTime() + RESERVATION_SECONDS * 1000).toISOString();
  const same = documents.find((d) => d.sha256 === request.sha256);

  // Uploading the same content again would re-index it (S2-12).
  if (same?.uploadState === 'UPLOADED') return { outcome: 'unchanged', document: same };

  // The same file, reserved but not arrived: a retry. A new URL for the same reservation.
  if (same) {
    if (!(await deps.store.extendDeadline(sub, same.id, deadline))) return { outcome: 'conflict' };
    await deps.bucket.putAcl(sub, same.objectKey); // in case the first attempt failed before writing it
    const upload = await deps.bucket.presignUpload(
      same.objectKey,
      same.type,
      same.size,
      same.sha256,
      now,
    );
    return { outcome: 'resumed', document: { ...same, uploadDeadline: deadline }, upload };
  }

  const id = newId();
  const document: StoredDocument = {
    id,
    name: request.name,
    type: request.type,
    size: request.size,
    sha256: request.sha256,
    objectKey: documentObjectKey(sub, id, request.type),
    uploadState: 'RESERVED',
    uploadDeadline: deadline,
    createdAt: now.toISOString(),
  };
  const reserved = await retryOnConflict(deps, () =>
    deps.store.reserve(sub, document, deps.limits),
  );
  if (reserved !== 'reserved') return { outcome: reserved };

  // The ACL file first: a document is never in the bucket without it (ADR-0007). If this fails,
  // the reservation has no URL, so the lazy release frees it after the deadline.
  await deps.bucket.putAcl(sub, document.objectKey);
  const upload = await deps.bucket.presignUpload(
    document.objectKey,
    document.type,
    document.size,
    document.sha256,
    now,
  );
  return { outcome: 'created', document, upload };
}

export async function listDocuments(
  deps: ServiceDeps,
  sub: string,
): Promise<{ documents: StoredDocument[]; usage: StorageUsage }> {
  const documents = await reconcile(deps, sub, await deps.store.list(sub));
  return { documents, usage: await deps.store.usage(sub) };
}

export type DeleteOutcome = 'deleted' | 'not-found' | 'upload-in-progress' | 'conflict';

export async function deleteDocument(
  deps: ServiceDeps,
  sub: string,
  id: string,
): Promise<DeleteOutcome> {
  if (!isId(id)) return 'not-found'; // no 400: an ID that can't exist is simply not found
  // The key holds the caller's sub, so another user's document ID is never found here.
  const document = await deps.store.get(sub, id);
  if (!document) return 'not-found';
  // Its URL may still be live. Deleting now could let the file arrive after its ACL is gone.
  if (
    document.uploadState === 'RESERVED' &&
    deps.now().getTime() <= Date.parse(document.uploadDeadline)
  ) {
    return 'upload-in-progress';
  }
  // The document, then its ACL file, then the item. A retry after a failure still finds the item
  // and finishes the job, and the document is never in the bucket without its ACL. The
  // ObjectRemoved event starts the sync (S3-08).
  await deps.bucket.deleteObject(document.objectKey);
  await deps.bucket.deleteObject(aclObjectKey(document.objectKey));
  const removed: RemoveOutcome = await retryOnConflict(deps, () =>
    deps.store.remove(sub, document, false),
  );
  return removed === 'conflict' ? 'conflict' : 'deleted'; // 'gone': a parallel delete got there first
}

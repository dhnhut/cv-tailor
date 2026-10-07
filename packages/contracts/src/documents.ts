import * as z from 'zod';

// The document API (S3-07, ADR-0007). Read by the API and the web app only, so not registered
// (ADR-0003): no JSON Schema or Pydantic model.

// KB-03. The extension is the type: ingestion picks a parser by it.
export const DOCUMENT_TYPES = ['txt', 'md', 'html', 'doc', 'docx', 'pdf'] as const;

// "50 MB" is 50,000,000 bytes (S3-07). The data source's filter is maxFileSizeInMegaBytes "50",
// and AWS doesn't say whether that counts 10^6 or 2^20 bytes per MB. 50,000,000 passes under
// either reading, so the API never accepts a file that ingestion would skip without telling anyone.
export const MAX_DOCUMENT_BYTES = 50_000_000; // one file (KB-03)
export const STORAGE_LIMIT_BYTES = 50_000_000; // all of a candidate's files (KB-06)
export const MAX_DOCUMENTS = 100; // KB-06, S3-07

// Every document and ACL file key starts with this. infra's IAM resources use it too.
export const DOCUMENTS_KEY_PREFIX = 'kb/';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const DocumentType = z.enum(DOCUMENT_TYPES).describe('The file extension, lowercase.');
export type DocumentType = z.infer<typeof DocumentType>;

// UPLOADING until the file is in S3. PENDING, INDEXED, and FAILED come from ingestion (S3-08).
export const DocumentStatus = z.enum(['UPLOADING', 'PENDING', 'INDEXED', 'FAILED']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const CreateDocumentRequest = z
  .strictObject({
    // Shown back to the candidate only. No control characters or path separators.
    name: z
      .string()
      .min(1)
      .max(255)
      // \p{Cc} is Unicode's "control" category: U+0000–U+001F, U+007F, and U+0080–U+009F. Written as a
      // property escape, not a range of control characters, which ESLint's no-control-regex refuses.
      .regex(/^[^\p{Cc}/\\]+$/u)
      .describe('The file name, ending in .<type>.'),
    type: DocumentType,
    size: z.int().min(1).max(MAX_DOCUMENT_BYTES).describe('The file size in bytes.'),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe("The file's SHA-256, lowercase hex. S3 checks it on upload."),
  })
  .describe('A file the candidate wants to add to their knowledge base.');
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;

export const DocumentSummary = z
  .strictObject({
    id: z.string().regex(UUID_V7),
    name: z.string(),
    type: DocumentType,
    size: z.int().min(1),
    status: DocumentStatus,
    createdAt: z.iso.datetime(),
  })
  .describe('One document in the knowledge base.');
export type DocumentSummary = z.infer<typeof DocumentSummary>;

// The browser sends exactly these headers. content-length is signed too, and the browser sets it
// from the body.
export const UploadInstructions = z.strictObject({
  method: z.literal('PUT'),
  url: z.url(),
  headers: z.strictObject({
    'content-type': z.string(),
    'x-amz-checksum-sha256': z.string(),
  }),
  expiresAt: z.iso.datetime(),
});
export type UploadInstructions = z.infer<typeof UploadInstructions>;

export const CreateDocumentResponse = z.discriminatedUnion('outcome', [
  // 201: a new reservation.
  z.strictObject({
    outcome: z.literal('created'),
    document: DocumentSummary,
    upload: UploadInstructions,
  }),
  // 200: the same file is already reserved and not yet uploaded. A new URL for the same reservation.
  z.strictObject({
    outcome: z.literal('resumed'),
    document: DocumentSummary,
    upload: UploadInstructions,
  }),
  // 200: the same content is already stored. Uploading it again would re-index it (S2-12).
  z.strictObject({ outcome: z.literal('unchanged'), document: DocumentSummary }),
]);
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

export const DocumentListResponse = z
  .strictObject({
    documents: z.array(DocumentSummary).max(MAX_DOCUMENTS),
    usedBytes: z.int().min(0),
    limitBytes: z.int(),
    documentCount: z.int().min(0),
    maxDocuments: z.int(),
  })
  .describe("The caller's documents, newest first, and their usage.");
export type DocumentListResponse = z.infer<typeof DocumentListResponse>;

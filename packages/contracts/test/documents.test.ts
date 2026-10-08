import { describe, expect, test } from 'vitest';
import {
  ApiErrorCode,
  ApiErrorResponse,
  contracts,
  CreateDocumentRequest,
  CreateDocumentResponse,
  DOCUMENT_TYPES,
  DOCUMENTS_KEY_PREFIX,
  DocumentListResponse,
  DocumentSummary,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  STORAGE_LIMIT_BYTES,
} from '../src/index.ts';

// The document API's bodies (S3-07). The API parses every request and response with these, and the
// web app (S3-09) parses the responses. Expected values are written out literally, so changing a
// limit or a rule in documents.ts also fails here.

const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'; // SHA-256 of "hello"
const ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b'; // a UUID v7
const CREATED_AT = '2026-10-07T09:15:00.000Z';

const request = (overrides: Record<string, unknown> = {}) => ({
  name: 'cv.pdf',
  type: 'pdf',
  size: 1024,
  sha256: SHA256,
  ...overrides,
});
const summary = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: 'cv.pdf',
  type: 'pdf',
  size: 1024,
  status: 'UPLOADING',
  createdAt: CREATED_AT,
  ...overrides,
});
const upload = (overrides: Record<string, unknown> = {}) => ({
  method: 'PUT',
  url: 'https://cv-tailor-dev-documents-111111111111.s3.us-east-1.amazonaws.com/kb/x/y.pdf?X-Amz-Expires=300',
  headers: {
    'content-type': 'application/pdf',
    'x-amz-checksum-sha256': 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
  },
  expiresAt: '2026-10-07T09:20:00.000Z',
  ...overrides,
});

// Each issue's code and path, so a test shows which rule refused the value.
const issuesOf = (result: {
  success: boolean;
  error?: { issues: { code: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map(({ code, path }) => ({ code, path }));

describe('limits (KB-03, KB-06)', () => {
  test('50 MB is 50,000,000 bytes, for one file and in total', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(50_000_000);
    expect(STORAGE_LIMIT_BYTES).toBe(50_000_000);
  });

  test('a candidate can have 100 documents', () => {
    expect(MAX_DOCUMENTS).toBe(100);
  });

  test('the types are the KB-03 list, lowercase', () => {
    expect(DOCUMENT_TYPES).toEqual(['txt', 'md', 'html', 'doc', 'docx', 'pdf']);
  });

  // infra's IAM resources are built from this prefix (infra/generated/contracts.json, infra/modules/api).
  test('every document key starts with kb/', () => {
    expect(DOCUMENTS_KEY_PREFIX).toBe('kb/');
  });
});

// Only TypeScript reads these, so no JSON Schema or Pydantic model is generated (ADR-0003).
test.each([
  ['CreateDocumentRequest', CreateDocumentRequest],
  ['CreateDocumentResponse', CreateDocumentResponse],
  ['DocumentListResponse', DocumentListResponse],
  ['ApiErrorResponse', ApiErrorResponse],
])('%s is not registered', (_, schema) => {
  expect(contracts.get(schema)).toBeUndefined();
});

describe('CreateDocumentRequest', () => {
  test.each(DOCUMENT_TYPES)('accepts a .%s file', (type) => {
    const body = request({ name: `notes.${type}`, type });
    expect(CreateDocumentRequest.parse(body)).toEqual(body);
  });

  test.each([
    ['the smallest file, 1 byte', { size: 1 }],
    ['a file of exactly 50,000,000 bytes', { size: 50_000_000 }],
    ['a name of 255 characters', { name: `${'a'.repeat(251)}.pdf` }],
    ['a name with spaces, accents, and a dash', { name: 'Résumé – Ana Müller.pdf' }],
  ])('accepts %s', (_, overrides) => {
    expect(CreateDocumentRequest.safeParse(request(overrides)).success).toBe(true);
  });

  test.each<[string, Record<string, unknown>, { code: string; path: string[] }[]]>([
    // Size (KB-03)
    ['one byte over 50 MB', { size: 50_000_001 }, [{ code: 'too_big', path: ['size'] }]],
    ['an empty file', { size: 0 }, [{ code: 'too_small', path: ['size'] }]],
    ['a fractional size', { size: 1.5 }, [{ code: 'invalid_type', path: ['size'] }]],
    ['a size sent as a string', { size: '1024' }, [{ code: 'invalid_type', path: ['size'] }]],
    // Type (KB-03)
    [
      'an executable',
      { name: 'run.exe', type: 'exe' },
      [{ code: 'invalid_value', path: ['type'] }],
    ],
    ['an image', { name: 'scan.png', type: 'png' }, [{ code: 'invalid_value', path: ['type'] }]],
    ['an uppercase type', { type: 'PDF' }, [{ code: 'invalid_value', path: ['type'] }]],
    // Hash: lowercase hex only, so two spellings of one hash can't both be stored
    [
      'an uppercase hash',
      { sha256: SHA256.toUpperCase() },
      [{ code: 'invalid_format', path: ['sha256'] }],
    ],
    [
      'a hash one character short',
      { sha256: SHA256.slice(1) },
      [{ code: 'invalid_format', path: ['sha256'] }],
    ],
    [
      'a base64 hash',
      { sha256: 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=' },
      [{ code: 'invalid_format', path: ['sha256'] }],
    ],
    // Name
    [
      'an empty name',
      { name: '' },
      [
        { code: 'too_small', path: ['name'] },
        { code: 'invalid_format', path: ['name'] },
      ],
    ],
    [
      'a name of 256 characters',
      { name: `${'a'.repeat(252)}.pdf` },
      [{ code: 'too_big', path: ['name'] }],
    ],
    ['a name with a slash', { name: '../cv.pdf' }, [{ code: 'invalid_format', path: ['name'] }]],
    [
      'a name with a backslash',
      { name: '..\\cv.pdf' },
      [{ code: 'invalid_format', path: ['name'] }],
    ],
    ['a name with a newline', { name: 'cv\n.pdf' }, [{ code: 'invalid_format', path: ['name'] }]],
    ['a name with a NUL', { name: 'cv\u0000.pdf' }, [{ code: 'invalid_format', path: ['name'] }]],
    ['a name with DEL', { name: 'cv\u007f.pdf' }, [{ code: 'invalid_format', path: ['name'] }]],
    [
      'a name with a C1 control character',
      { name: 'cv\u0085.pdf' },
      [{ code: 'invalid_format', path: ['name'] }],
    ],
  ])('refuses %s', (_, overrides, expected) => {
    expect(issuesOf(CreateDocumentRequest.safeParse(request(overrides)))).toEqual(expected);
  });

  // A missing enum field is invalid_value, not invalid_type
  // Zod 4 checks an enum by comparing the value,
  // here undefined, with its options
  test.each([
    ['name', 'invalid_type'],
    ['type', 'invalid_value'],
    ['size', 'invalid_type'],
    ['sha256', 'invalid_type'],
  ])('refuses a request without %s', (key, code) => {
    const body: Record<string, unknown> = request();
    delete body[key];
    expect(issuesOf(CreateDocumentRequest.safeParse(body))).toEqual([{ code, path: [key] }]);
  });

  test('refuses unknown keys (strictObject)', () => {
    const result = CreateDocumentRequest.safeParse(request({ key: 'kb/other-user/x.pdf' }));
    expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['key'] }]);
  });
});

describe('DocumentSummary', () => {
  test.each(['UPLOADING', 'PENDING', 'INDEXED', 'FAILED'])('accepts the status %s', (status) => {
    expect(DocumentSummary.parse(summary({ status }))).toEqual(summary({ status }));
  });

  test.each([
    ['a UUID v4 ID', { id: '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f' }],
    ['an unknown status', { status: 'DELETED' }],
    ['a date without a time', { createdAt: '2026-10-07' }],
  ])('refuses %s', (_, overrides) => {
    expect(DocumentSummary.safeParse(summary(overrides)).success).toBe(false);
  });

  // The hash and the S3 key stay in the API. A field added to a response by mistake fails here.
  test.each([
    ['the hash', { sha256: SHA256 }],
    ['the S3 key', { objectKey: `kb/x/${ID}.pdf` }],
  ])('never carries %s', (_, extra) => {
    expect(DocumentSummary.safeParse(summary(extra)).success).toBe(false);
  });
});

describe('CreateDocumentResponse', () => {
  test.each([
    ['created', { outcome: 'created', document: summary(), upload: upload() }],
    ['resumed', { outcome: 'resumed', document: summary(), upload: upload() }],
    ['unchanged', { outcome: 'unchanged', document: summary({ status: 'PENDING' }) }],
  ])('accepts %s', (_, body) => {
    expect(CreateDocumentResponse.parse(body)).toEqual(body);
  });

  test.each([
    ['created without an upload', { outcome: 'created', document: summary() }],
    ['unchanged with an upload', { outcome: 'unchanged', document: summary(), upload: upload() }],
    ['an unknown outcome', { outcome: 'replaced', document: summary() }],
    [
      'a presigned POST',
      { outcome: 'created', document: summary(), upload: upload({ method: 'POST' }) },
    ],
    [
      'an upload URL that is not a URL',
      { outcome: 'created', document: summary(), upload: upload({ url: 'kb/x/y.pdf' }) },
    ],
    [
      'an extra upload header',
      {
        outcome: 'created',
        document: summary(),
        upload: upload({ headers: { ...upload().headers, 'x-amz-acl': 'public-read' } }),
      },
    ],
  ])('refuses %s', (_, body) => {
    expect(CreateDocumentResponse.safeParse(body).success).toBe(false);
  });
});

describe('DocumentListResponse', () => {
  const list = (documents: unknown[], usedBytes = 0) => ({
    documents,
    usedBytes,
    limitBytes: 50_000_000,
    documentCount: documents.length,
    maxDocuments: 100,
  });

  test('accepts an empty knowledge base', () => {
    expect(DocumentListResponse.parse(list([]))).toEqual(list([]));
  });

  test('accepts 100 documents', () => {
    expect(
      DocumentListResponse.safeParse(list(Array.from({ length: 100 }, () => summary()))).success,
    ).toBe(true);
  });

  test('refuses 101 documents', () => {
    const result = DocumentListResponse.safeParse(
      list(Array.from({ length: 101 }, () => summary())),
    );
    expect(issuesOf(result)).toEqual([{ code: 'too_big', path: ['documents'] }]);
  });

  test('refuses negative usage', () => {
    expect(DocumentListResponse.safeParse(list([], -1)).success).toBe(false);
  });
});

describe('ApiErrorResponse', () => {
  test.each(ApiErrorCode.options)('accepts the code %s', (code) => {
    expect(ApiErrorResponse.parse({ code, message: 'm' })).toEqual({ code, message: 'm' });
  });

  test('refuses an unknown code', () => {
    expect(ApiErrorResponse.safeParse({ code: 'teapot', message: 'm' }).success).toBe(false);
  });

  // The web app reads the code. A message without one means the API changed its contract.
  test("refuses a body without a code, like API Gateway's own errors", () => {
    expect(ApiErrorResponse.safeParse({ message: 'Unauthorized' }).success).toBe(false);
  });
});

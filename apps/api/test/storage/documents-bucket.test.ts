import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DOCUMENT_TYPES, type UploadInstructions } from '@cv-tailor/contracts';
import { describe, expect, test, vi } from 'vitest';
import { S3_CLIENT_CONFIG } from '../../src/aws.ts';
import {
  CONTENT_TYPES,
  type DocumentBucket,
  s3DocumentBucket,
  UPLOAD_URL_SECONDS,
} from '../../src/storage/documents-bucket.ts';
import { expectCommands, fakeSend } from '../aws-fakes.ts';

// The documents bucket (S3-07). Presigning is local: the SDK signs with the credentials it has and
// sends nothing, so a fixed signing date makes the URL the same on every run. The other calls go
// through a fake send, and their exact inputs are pinned.

const BUCKET = 'cv-tailor-test-documents';
const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b';
const KEY = `kb/${SUB}/${DOC_ID}.pdf`;
const ACL_KEY = `${KEY}.metadata.json`;
const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'; // "hello"
const CHECKSUM = 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ='; // the same hash in base64
const NOW = new Date('2026-10-07T09:15:00.000Z');

const setup = (...responses: unknown[]) => {
  // The production settings, with fixed test credentials, so presigning needs no AWS account.
  const client = new S3Client({
    ...S3_CLIENT_CONFIG,
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'test-secret' },
  });
  const send = fakeSend(...responses);
  vi.spyOn(client, 'send').mockImplementation(send as never);
  return { send, bucket: s3DocumentBucket(client, BUCKET) };
};

// A presigned URL's query parameters, without the signature.
const paramsOf = (url: string) =>
  Object.fromEntries([...new URL(url).searchParams].filter(([name]) => name !== 'X-Amz-Signature'));
const signatureOf = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');

describe('presignUpload', () => {
  test('a PUT to the document key, valid for 5 minutes, with size, type, and hash signed', async () => {
    const { bucket, send } = setup();

    const upload = await bucket.presignUpload(KEY, 'pdf', 1_000, SHA256, NOW);

    const url = new URL(upload.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://${BUCKET}.s3.us-east-1.amazonaws.com/${KEY}`,
    );
    // An exact match: a parameter added by a future SDK, such as a checksum the browser can't
    // match, fails here. The checksum stays a signed header, never a query parameter.
    expect(paramsOf(upload.url)).toEqual({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      // The signature doesn't cover the body. The signed checksum header does: S3 hashes the
      // body it receives and refuses it with BadDigest if the hash differs.
      'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
      'X-Amz-Credential': 'AKIDEXAMPLE/20261007/us-east-1/s3/aws4_request',
      'X-Amz-Date': '20261007T091500Z',
      'X-Amz-Expires': '300',
      'X-Amz-SignedHeaders': 'content-length;content-type;host;x-amz-checksum-sha256',
      'x-id': 'PutObject',
    });
    expect(signatureOf(upload.url)).toMatch(/^[0-9a-f]{64}$/);
    expect(upload).toEqual({
      method: 'PUT',
      url: upload.url,
      headers: { 'content-type': 'application/pdf', 'x-amz-checksum-sha256': CHECKSUM },
      expiresAt: '2026-10-07T09:20:00.000Z',
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('the URL lives for 5 minutes', () => {
    expect(UPLOAD_URL_SECONDS).toBe(300);
  });

  test('each type is signed with its content type', () => {
    expect(CONTENT_TYPES).toEqual({
      txt: 'text/plain',
      md: 'text/markdown',
      html: 'text/html',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  test.each(DOCUMENT_TYPES)('a .%s upload tells the browser its content type', async (type) => {
    const { bucket } = setup();

    const upload = await bucket.presignUpload(
      `kb/${SUB}/${DOC_ID}.${type}`,
      type,
      1_000,
      SHA256,
      NOW,
    );

    expect(upload.headers['content-type']).toBe(CONTENT_TYPES[type]);
  });

  // The same inputs sign the same URL. A change to any signed value changes the signature, so a
  // browser that sends another size, type, or hash fails S3's signature check.
  test.each<[string, (bucket: DocumentBucket) => Promise<UploadInstructions>]>([
    ['size', (bucket) => bucket.presignUpload(KEY, 'pdf', 1_001, SHA256, NOW)],
    ['type', (bucket) => bucket.presignUpload(KEY, 'md', 1_000, SHA256, NOW)],
    ['hash', (bucket) => bucket.presignUpload(KEY, 'pdf', 1_000, `3${SHA256.slice(1)}`, NOW)],
    ['key', (bucket) => bucket.presignUpload(ACL_KEY, 'pdf', 1_000, SHA256, NOW)],
  ])('a different %s gives a different signature', async (_, presign) => {
    const { bucket } = setup();

    const first = await bucket.presignUpload(KEY, 'pdf', 1_000, SHA256, NOW);
    const again = await bucket.presignUpload(KEY, 'pdf', 1_000, SHA256, NOW);
    const changed = await presign(bucket);

    expect(signatureOf(again.url)).toBe(signatureOf(first.url));
    expect(signatureOf(changed.url)).not.toBe(signatureOf(first.url));
  });
});

describe('putAcl', () => {
  test('writes the owner-only ACL file next to the document', async () => {
    const { bucket, send } = setup({});

    await bucket.putAcl(SUB, KEY);

    expectCommands(send, [
      PutObjectCommand,
      {
        Bucket: BUCKET,
        Key: ACL_KEY,
        Body: `{"metadataAttributes":{},"accessControlList":[{"Name":"${SUB}@users.cv-tailor.invalid","Type":"USER","Access":"ALLOW"}]}`,
        ContentType: 'application/json',
      },
    ]);
  });

  test('refuses a bad sub before any call', async () => {
    const { bucket, send } = setup();

    await expect(bucket.putAcl('alice@example.com', KEY)).rejects.toThrow(
      'Invalid sub for an ACL identity',
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('listObjectKeys', () => {
  const listInput = (token?: string) => ({
    Bucket: BUCKET,
    Prefix: `kb/${SUB}/`,
    ContinuationToken: token,
  });

  test("lists the caller's prefix only", async () => {
    const { bucket, send } = setup({ Contents: [{ Key: KEY }, { Key: ACL_KEY }] });

    await expect(bucket.listObjectKeys(SUB)).resolves.toEqual(new Set([KEY, ACL_KEY]));
    expectCommands(send, [ListObjectsV2Command, listInput()]);
  });

  test('follows the continuation token to the last page', async () => {
    const { bucket, send } = setup(
      { Contents: [{ Key: KEY }], NextContinuationToken: 'page-2' },
      { Contents: [{ Key: ACL_KEY }] },
    );

    await expect(bucket.listObjectKeys(SUB)).resolves.toEqual(new Set([KEY, ACL_KEY]));
    expectCommands(
      send,
      [ListObjectsV2Command, listInput()],
      [ListObjectsV2Command, listInput('page-2')],
    );
  });

  test.each([
    ['an empty prefix', {}],
    ['an entry without a key', { Contents: [{}] }],
  ])('%s gives no keys', async (_, page) => {
    const { bucket } = setup(page);

    await expect(bucket.listObjectKeys(SUB)).resolves.toEqual(new Set());
  });

  test('refuses a bad sub before any call', async () => {
    const { bucket, send } = setup();

    await expect(bucket.listObjectKeys('alice@example.com')).rejects.toThrow(
      'Invalid sub for a documents bucket key',
    );
    expect(send).not.toHaveBeenCalled();
  });
});

test('deleteObject deletes exactly one key', async () => {
  const { bucket, send } = setup({});

  await bucket.deleteObject(KEY);

  expectCommands(send, [DeleteObjectCommand, { Bucket: BUCKET, Key: KEY }]);
});

test.each<[string, (bucket: DocumentBucket) => Promise<unknown>]>([
  ['putAcl', (bucket) => bucket.putAcl(SUB, KEY)],
  ['listObjectKeys', (bucket) => bucket.listObjectKeys(SUB)],
  ['deleteObject', (bucket) => bucket.deleteObject(KEY)],
])('%s passes on an S3 error', async (_, call) => {
  const failure = new Error('SlowDown');
  const { bucket } = setup(failure);

  await expect(call(bucket)).rejects.toBe(failure);
});

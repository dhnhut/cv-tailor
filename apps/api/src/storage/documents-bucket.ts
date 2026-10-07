import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { DocumentType, UploadInstructions } from '@cv-tailor/contracts';
import { aclFileBody } from '../knowledge-base/acl.ts';
import { aclObjectKey, userObjectPrefix } from './keys.ts';

// Short: the URL is a bearer credential for one key. A 50 MB upload that starts before it expires
// may finish after it. The reservation's 1-hour deadline covers that (documents/service.ts).
export const UPLOAD_URL_SECONDS = 300;

export const CONTENT_TYPES: Record<DocumentType, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export interface DocumentBucket {
  putAcl(sub: string, documentKey: string): Promise<void>;
  presignUpload(
    documentKey: string,
    type: DocumentType,
    size: number,
    sha256Hex: string,
    now: Date,
  ): Promise<UploadInstructions>;
  listObjectKeys(sub: string): Promise<Set<string>>; // the caller's prefix only
  deleteObject(key: string): Promise<void>;
}

export const s3DocumentBucket = (client: S3Client, bucket: string): DocumentBucket => ({
  async putAcl(sub, documentKey) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: aclObjectKey(documentKey),
        Body: aclFileBody(sub),
        ContentType: 'application/json',
      }),
    );
  },

  // A presigned PUT, not a presigned POST (S3-07). With these three headers signed, S3 refuses a
  // body of another size (SignatureDoesNotMatch) or another SHA-256 (BadDigest), so the hash the API
  // stored for skipping duplicates is the real content's hash. The checksum stays a header: if
  // it moved to the query string, the browser could leave it out.
  async presignUpload(documentKey, type, size, sha256Hex, now) {
    const checksum = Buffer.from(sha256Hex, 'hex').toString('base64');
    const contentType = CONTENT_TYPES[type];
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: documentKey,
        ContentType: contentType,
        ContentLength: size,
        ChecksumSHA256: checksum,
      }),
      {
        expiresIn: UPLOAD_URL_SECONDS,
        signingDate: now,
        signableHeaders: new Set(['content-length', 'content-type', 'x-amz-checksum-sha256']),
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      },
    );
    return {
      method: 'PUT',
      url,
      headers: { 'content-type': contentType, 'x-amz-checksum-sha256': checksum },
      expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString(),
    };
  },

  async listObjectKeys(sub) {
    const keys = new Set<string>();
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: userObjectPrefix(sub),
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) if (object.Key) keys.add(object.Key);
      token = page.NextContinuationToken;
    } while (token);
    return keys;
  },

  async deleteObject(key) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); // idempotent
  },
});

import { DOCUMENT_TYPES, DOCUMENTS_KEY_PREFIX, type DocumentType } from '@cv-tailor/contracts';
import { isId, isSub } from '../data/keys.ts';

// S3 keys in the documents bucket (S3-07, ADR-0007). The file's real name stays in DynamoDB: the key
// holds no PII and no characters that need escaping.
const check = (part: string, value: string, valid: (v: string) => boolean): string => {
  if (!valid(value)) throw new Error(`Invalid ${part} for a documents bucket key`);
  return value;
};

const isType = (value: string): boolean => (DOCUMENT_TYPES as readonly string[]).includes(value);

export const userObjectPrefix = (sub: string): string =>
  `${DOCUMENTS_KEY_PREFIX}${check('sub', sub, isSub)}/`;

export const documentObjectKey = (sub: string, id: string, type: DocumentType): string =>
  `${userObjectPrefix(sub)}${check('document ID', id, isId)}.${check('type', type, isType)}`;

// The ACL file goes next to its document (ADR-0007).
export const aclObjectKey = (documentKey: string): string => `${documentKey}.metadata.json`;

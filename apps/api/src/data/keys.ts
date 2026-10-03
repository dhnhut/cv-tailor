// Key formats for the data table (S2-08, ADR-0006). Every key in the table is built here, so a
// format is defined once and tested once. Pure functions with no AWS calls.

// Attribute names. infra/lib/data-stack.ts writes the same names out (PK, SK, TTL).
export const ATTRIBUTES = { pk: 'PK', sk: 'SK', entity: 'Entity', expiresAt: 'expiresAt' } as const;

// The Entity attribute on each kind of item, so a scan or an export can be filtered by kind.
export const ENTITY = {
  profile: 'Profile',
  quotaOverride: 'QuotaOverride',
  quotaCounter: 'QuotaCounter',
  kbDocument: 'KbDocument',
  generationJob: 'GenerationJob',
} as const;

export interface Key {
  readonly PK: string;
  readonly SK: string;
}

// SK prefixes for queries with begins_with(SK, prefix).
export const KB_DOCUMENT_PREFIX = 'DOC#';
export const GENERATION_JOB_PREFIX = 'JOB#';

// A Cognito sub is a lowercase UUID. The check catches a username or an email address passed by mistake.
const SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// IDs for documents and jobs: no '#', so an ID can't add a level to the key. Sprint 3 picks the ID format.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// The message names the part, never the value: Lambda logs thrown messages (S2-07).
const check = (part: string, value: string, pattern: RegExp): string => {
  if (!pattern.test(value)) throw new Error(`Invalid ${part} for a data table key`);
  return value;
};

// Quota days and months are UTC (QUOTA-02). toISOString() is always UTC, whatever the host's time zone.
const utcDate = (at: Date): string => {
  if (Number.isNaN(at.getTime())) throw new Error('Invalid date for a data table key');
  return at.toISOString().slice(0, 10); // YYYY-MM-DD
};

// The whole partition, for listing or deleting everything a user has (ADR-0006, Access).
export const userPartition = (sub: string): string => `USER#${check('sub', sub, SUB)}`;

export const profileKey = (sub: string): Key => ({ PK: userPartition(sub), SK: 'PROFILE' });
export const quotaOverrideKey = (sub: string): Key => ({
  PK: userPartition(sub),
  SK: 'QUOTA_OVERRIDE',
});
// The counters for the UTC day and month that `at` falls in.
export const dailyCounterKey = (sub: string, at: Date): Key => ({
  PK: userPartition(sub),
  SK: `QUOTA#DAY#${utcDate(at)}`,
});
export const monthlyCounterKey = (sub: string, at: Date): Key => ({
  PK: userPartition(sub),
  SK: `QUOTA#MONTH#${utcDate(at).slice(0, 7)}`, // YYYY-MM
});
export const kbDocumentKey = (sub: string, id: string): Key => ({
  PK: userPartition(sub),
  SK: `${KB_DOCUMENT_PREFIX}${check('document ID', id, ID)}`,
});
export const generationJobKey = (sub: string, id: string): Key => ({
  PK: userPartition(sub),
  SK: `${GENERATION_JOB_PREFIX}${check('job ID', id, ID)}`,
});

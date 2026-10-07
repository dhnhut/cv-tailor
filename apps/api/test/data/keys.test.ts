import { describe, expect, test } from 'vitest';
import {
  ATTRIBUTES,
  dailyCounterKey,
  ENTITY,
  GENERATION_JOB_PREFIX,
  generationJobKey,
  isId,
  isSub,
  KB_DOCUMENT_PREFIX,
  kbDocumentKey,
  type Key,
  monthlyCounterKey,
  newId,
  profileKey,
  quotaOverrideKey,
  storageUsageKey,
  userPartition,
} from '../../src/data/keys.ts';

// Key formats for the data table (S2-08, ADR-0006). Expected keys are written out literally from
// the ADR's table, so changing a format in keys.ts also fails here.

const SUB = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PK = `USER#${SUB}`;
const AT = new Date('2026-10-03T12:00:00Z');
const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b'; // a UUID v7
const JOB_ID = '019ab3c4-5d6f-7012-8345-6789abcdef01'; // a UUID v7, 1 ms later

describe('keys match ADR-0006', () => {
  test.each<[string, () => Key, string]>([
    ['profile', () => profileKey(SUB), 'PROFILE'],
    ['quota override', () => quotaOverrideKey(SUB), 'QUOTA_OVERRIDE'],
    ['daily counter', () => dailyCounterKey(SUB, AT), 'QUOTA#DAY#2026-10-03'],
    ['monthly counter', () => monthlyCounterKey(SUB, AT), 'QUOTA#MONTH#2026-10'],
    ['KB document', () => kbDocumentKey(SUB, DOC_ID), `DOC#${DOC_ID}`],
    ['generation job', () => generationJobKey(SUB, JOB_ID), `JOB#${JOB_ID}`],
    ['storage usage', () => storageUsageKey(SUB), 'STORAGE'],
  ])('%s', (_, build, sk) => {
    expect(build()).toEqual({ PK, SK: sk });
  });

  // Account deletion and data export query this partition (ADR-0006, Access).
  test('the user partition', () => {
    expect(userPartition(SUB)).toBe(PK);
  });

  test('attribute and entity names', () => {
    expect(ATTRIBUTES).toEqual({ pk: 'PK', sk: 'SK', entity: 'Entity', expiresAt: 'expiresAt' });
    expect(ENTITY).toEqual({
      profile: 'Profile',
      quotaOverride: 'QuotaOverride',
      quotaCounter: 'QuotaCounter',
      kbDocument: 'KbDocument',
      generationJob: 'GenerationJob',
      storageUsage: 'StorageUsage',
    });
  });
});

// QUOTA-02: quota days and months are UTC. Offsets in the inputs show the host's time zone and
// the user's don't matter.
describe('quota counters use the UTC day and month', () => {
  test.each([
    ['2026-10-03T00:00:00.000Z', 'QUOTA#DAY#2026-10-03'],
    ['2026-10-03T23:59:59.999Z', 'QUOTA#DAY#2026-10-03'],
    ['2026-10-04T00:00:00.000Z', 'QUOTA#DAY#2026-10-04'],
    ['2026-10-04T09:00:00+13:00', 'QUOTA#DAY#2026-10-03'], // Sunday morning in Auckland (NZDT)
    ['2028-02-29T12:00:00Z', 'QUOTA#DAY#2028-02-29'], // a leap day
  ])('%s counts towards %s', (at, sk) => {
    expect(dailyCounterKey(SUB, new Date(at)).SK).toBe(sk);
  });

  test.each([
    ['2026-10-31T23:59:59.999Z', 'QUOTA#MONTH#2026-10'],
    ['2026-11-01T00:00:00.000Z', 'QUOTA#MONTH#2026-11'],
    ['2026-11-01T10:00:00+11:00', 'QUOTA#MONTH#2026-10'], // 1 November, morning in Sydney (AEDT)
    ['2027-01-01T00:00:00.000Z', 'QUOTA#MONTH#2027-01'],
  ])('%s counts towards %s', (at, sk) => {
    expect(monthlyCounterKey(SUB, new Date(at)).SK).toBe(sk);
  });

  test('refuses an invalid date', () => {
    const invalid = new Date('not a date');
    expect(() => dailyCounterKey(SUB, invalid)).toThrow(/^Invalid date for a data table key$/);
    expect(() => monthlyCounterKey(SUB, invalid)).toThrow(/^Invalid date for a data table key$/);
  });
});

// A wrong value would otherwise make a valid-looking key in the wrong place. Each regex matches
// the whole message, so a refused value never appears in it: Lambda logs thrown messages (S2-07,
// SAFE-04).
describe('refuses a bad key part, and never repeats it in the error', () => {
  const BY_SUB: (readonly [string, (sub: string) => unknown])[] = [
    ['userPartition', (sub) => userPartition(sub)],
    ['profileKey', (sub) => profileKey(sub)],
    ['quotaOverrideKey', (sub) => quotaOverrideKey(sub)],
    ['dailyCounterKey', (sub) => dailyCounterKey(sub, AT)],
    ['monthlyCounterKey', (sub) => monthlyCounterKey(sub, AT)],
    ['kbDocumentKey', (sub) => kbDocumentKey(sub, DOC_ID)],
    ['generationJobKey', (sub) => generationJobKey(sub, JOB_ID)],
    ['storageUsageKey', (sub) => storageUsageKey(sub)],
  ];

  test.each([
    ['empty', ''],
    ['an email address', 'alice@example.com'],
    ['a Google username', 'google_109876543210987654321'],
    ['capital letters', SUB.toUpperCase()],
    ['an extra key level', `${SUB}#PROFILE`],
    ['a leading space', ` ${SUB}`],
  ])('sub: %s', (_, sub) => {
    expect(isSub(sub)).toBe(false); // isSub agrees with the key builders
    for (const [, build] of BY_SUB) {
      expect(() => build(sub)).toThrow(/^Invalid sub for a data table key$/);
    }
  });

  test.each([
    ['empty', ''],
    ['a UUID v4', '7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    ['a ULID', '01J9ZQ3V8X4K2M7N5P6R8S0T1V'],
    ['capital letters', DOC_ID.toUpperCase()],
    ['no hyphens', DOC_ID.replaceAll('-', '')],
    ['the wrong variant', '019ab3c4-5d6e-7f80-ca1b-2c3d4e5f6a7b'],
    ["an extra key level after a '#'", `${DOC_ID}#PROFILE`],
    ['an extra character', `${DOC_ID}0`],
    ['a leading space', ` ${DOC_ID}`],
    ['a trailing newline', `${DOC_ID}\n`],
    ['a path', `../${DOC_ID}`],
  ])('document and job ID: %s', (_, id) => {
    expect(isId(id)).toBe(false); // isId agrees with the key builders
    expect(() => kbDocumentKey(SUB, id)).toThrow(/^Invalid document ID for a data table key$/);
    expect(() => generationJobKey(SUB, id)).toThrow(/^Invalid job ID for a data table key$/);
  });

  test.each(['8', '9', 'a', 'b'])('accepts a UUID v7 with variant digit %s', (variant) => {
    const id = `019ab3c4-5d6e-7f80-${variant}a1b-2c3d4e5f6a7b`;
    expect(isId(id)).toBe(true);
    expect(kbDocumentKey(SUB, id).SK).toBe(`DOC#${id}`);
    expect(generationJobKey(SUB, id).SK).toBe(`JOB#${id}`);
  });
});

// begins_with(SK, prefix) must return only its own kind of item (ADR-0006, Access).
test('only document keys start with DOC#, and only job keys with JOB#', () => {
  expect(KB_DOCUMENT_PREFIX).toBe('DOC#');
  expect(GENERATION_JOB_PREFIX).toBe('JOB#');

  const others = [
    profileKey(SUB),
    quotaOverrideKey(SUB),
    dailyCounterKey(SUB, AT),
    monthlyCounterKey(SUB, AT),
    storageUsageKey(SUB),
  ];
  const doc = kbDocumentKey(SUB, DOC_ID);
  const job = generationJobKey(SUB, JOB_ID);

  expect(doc.SK.startsWith(KB_DOCUMENT_PREFIX)).toBe(true);
  expect(job.SK.startsWith(GENERATION_JOB_PREFIX)).toBe(true);
  for (const { SK } of [...others, job]) expect(SK.startsWith(KB_DOCUMENT_PREFIX)).toBe(false);
  for (const { SK } of [...others, doc]) expect(SK.startsWith(GENERATION_JOB_PREFIX)).toBe(false);
});

// isSub and isId let a caller check a value without catching a throw: DELETE /documents/{id}
// answers 404 to a malformed ID (S3-07). The refusal tables above check every bad value with
// them too, so they can't drift from the key builders.
describe('isSub and isId', () => {
  test('accept the values the key builders accept', () => {
    expect(isSub(SUB)).toBe(true);
    expect(isId(DOC_ID)).toBe(true);
    expect(isId(newId())).toBe(true);
  });

  // Any lowercase UUID is a sub. Only a UUID v7 is an ID.
  test('a sub (a UUID v4) is not a document ID', () => {
    expect(isId(SUB)).toBe(false);
  });
});

// S3-03: IDs are UUID v7, so a query with ScanIndexForward: false lists the newest first.
describe('newId', () => {
  test('makes an ID that document and job keys accept', () => {
    const id = newId();
    expect(kbDocumentKey(SUB, id).SK).toBe(`DOC#${id}`);
    expect(generationJobKey(SUB, id).SK).toBe(`JOB#${id}`);
  });

  test('starts with its creation time in milliseconds', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const createdAt = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });

  // DynamoDB sorts string keys by their bytes, as JavaScript's < does for ASCII. Within one
  // millisecond the order is random (Node has no counter), so the test waits for the next one.
  test('an ID from a later millisecond sorts after an earlier one', () => {
    const first = newId();
    const madeBy = Date.now();
    while (Date.now() <= madeBy) {
      // wait for the next millisecond
    }
    expect(newId() > first).toBe(true);
  });
});

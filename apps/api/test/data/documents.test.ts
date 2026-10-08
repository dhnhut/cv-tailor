import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, test } from 'vitest';
import {
  type DocumentStore,
  dynamoDocumentStore,
  type StoredDocument,
} from '../../src/data/documents.ts';
import { cancelled, conditionFailed, expectCommands, fakeSend } from '../aws-fakes.ts';

// The exact DynamoDB requests the document API sends (S3-07). The IAM policies in
// infra/modules/api/main.tf allow only the actions these commands need, so a new command here needs a
// policy change too. Inputs are written out literally, so a changed key, attribute, or condition
// fails here.
//
// The conditions are what hold the 50 MB cap and prevent a double free. This test pins their
// text. It can't prove DynamoDB applies them as one step: the live check in S3-07's verification
// does that, with parallel requests against the real table.

const TABLE = 'cv-tailor-test-data';
const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const DOC_ID = '019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b'; // a UUID v7
const OLDER_ID = '019ab3c4-5d6d-7f80-9a1b-2c3d4e5f6a7b'; // 1 ms earlier
const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const DEADLINE = '2026-10-07T10:15:00.000Z';
const LIMITS = { maxBytes: 50_000_000, maxDocuments: 100 };

const PK = { S: `USER#${SUB}` };
const DOC_KEY = { PK, SK: { S: `DOC#${DOC_ID}` } };
const STORAGE_KEY = { PK, SK: { S: 'STORAGE' } };
// ClientRequestToken: a random UUID v4, new for every call.
const TOKEN: unknown = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

const DOCUMENT: StoredDocument = {
  id: DOC_ID,
  name: 'Résumé 2026.pdf',
  type: 'pdf',
  size: 1_000,
  sha256: SHA256,
  objectKey: `kb/${SUB}/${DOC_ID}.pdf`,
  uploadState: 'RESERVED',
  uploadDeadline: DEADLINE,
  createdAt: '2026-10-07T09:15:00.000Z',
};
// The item DynamoDB holds for DOCUMENT, attribute by attribute (ADR-0006).
const ITEM = {
  ...DOC_KEY,
  Entity: { S: 'KbDocument' },
  name: { S: 'Résumé 2026.pdf' },
  type: { S: 'pdf' },
  size: { N: '1000' },
  sha256: { S: SHA256 },
  objectKey: { S: `kb/${SUB}/${DOC_ID}.pdf` },
  uploadState: { S: 'RESERVED' },
  uploadDeadline: { S: DEADLINE },
  createdAt: { S: '2026-10-07T09:15:00.000Z' },
};
const OLDER: StoredDocument = {
  ...DOCUMENT,
  id: OLDER_ID,
  name: 'notes.md',
  type: 'md',
  objectKey: `kb/${SUB}/${OLDER_ID}.md`,
  uploadState: 'UPLOADED',
};
const OLDER_ITEM = {
  ...ITEM,
  SK: { S: `DOC#${OLDER_ID}` },
  name: { S: 'notes.md' },
  type: { S: 'md' },
  objectKey: { S: `kb/${SUB}/${OLDER_ID}.md` },
  uploadState: { S: 'UPLOADED' },
};
const usageItem = (usedBytes: number, documentCount: number) => ({
  Item: {
    ...STORAGE_KEY,
    Entity: { S: 'StorageUsage' },
    usedBytes: { N: String(usedBytes) },
    documentCount: { N: String(documentCount) },
  },
});

const queryInput = (exclusiveStartKey?: unknown) => ({
  TableName: TABLE,
  KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
  ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
  ExpressionAttributeValues: { ':pk': PK, ':prefix': { S: 'DOC#' } },
  ScanIndexForward: false,
  ConsistentRead: true,
  ExclusiveStartKey: exclusiveStartKey,
});
const GET_DOCUMENT_INPUT = { TableName: TABLE, Key: DOC_KEY, ConsistentRead: true };
const GET_USAGE_INPUT = { TableName: TABLE, Key: STORAGE_KEY, ConsistentRead: true };

const reserveInput = (room: string) => ({
  ClientRequestToken: TOKEN,
  TransactItems: [
    {
      Update: {
        TableName: TABLE,
        Key: STORAGE_KEY,
        UpdateExpression: 'SET #entity = :entity ADD #used :size, #count :one',
        ConditionExpression:
          'attribute_not_exists(#used) OR (#used <= :room AND #count < :maxCount)',
        ExpressionAttributeNames: {
          '#entity': 'Entity',
          '#used': 'usedBytes',
          '#count': 'documentCount',
        },
        ExpressionAttributeValues: {
          ':entity': { S: 'StorageUsage' },
          ':size': { N: '1000' },
          ':one': { N: '1' },
          ':room': { N: room },
          ':maxCount': { N: '100' },
        },
      },
    },
    {
      Put: {
        TableName: TABLE,
        Item: ITEM,
        ConditionExpression: 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'PK' },
      },
    },
  ],
});

// The second item of every remove: free the document's bytes and its place in the count.
const FREE_BYTES = {
  Update: {
    TableName: TABLE,
    Key: STORAGE_KEY,
    UpdateExpression: 'ADD #used :minusSize, #count :minusOne',
    ConditionExpression: 'attribute_exists(#used)',
    ExpressionAttributeNames: { '#used': 'usedBytes', '#count': 'documentCount' },
    ExpressionAttributeValues: { ':minusSize': { N: '-1000' }, ':minusOne': { N: '-1' } },
  },
};
const DELETE_INPUT = {
  ClientRequestToken: TOKEN,
  TransactItems: [
    {
      Delete: {
        TableName: TABLE,
        Key: DOC_KEY,
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#pk': 'PK' },
      },
    },
    FREE_BYTES,
  ],
};
const RELEASE_INPUT = {
  ClientRequestToken: TOKEN,
  TransactItems: [
    {
      Delete: {
        TableName: TABLE,
        Key: DOC_KEY,
        ConditionExpression: 'attribute_exists(#pk) AND #state = :reserved',
        ExpressionAttributeNames: { '#pk': 'PK', '#state': 'uploadState' },
        ExpressionAttributeValues: { ':reserved': { S: 'RESERVED' } },
      },
    },
    FREE_BYTES,
  ],
};
const MARK_UPLOADED_INPUT = {
  TableName: TABLE,
  Key: DOC_KEY,
  UpdateExpression: 'SET #state = :uploaded',
  ConditionExpression: '#state = :reserved',
  ExpressionAttributeNames: { '#state': 'uploadState' },
  ExpressionAttributeValues: { ':uploaded': { S: 'UPLOADED' }, ':reserved': { S: 'RESERVED' } },
};
const EXTEND_INPUT = {
  TableName: TABLE,
  Key: DOC_KEY,
  UpdateExpression: 'SET #deadline = :deadline',
  ConditionExpression: '#state = :reserved',
  ExpressionAttributeNames: { '#state': 'uploadState', '#deadline': 'uploadDeadline' },
  ExpressionAttributeValues: { ':deadline': { S: DEADLINE }, ':reserved': { S: 'RESERVED' } },
};

const setup = (...responses: unknown[]) => {
  const send = fakeSend(...responses);
  return { send, store: dynamoDocumentStore({ send }, TABLE) };
};
// The input of the call at this index, for a test that looks at one value.
const inputOf = (send: ReturnType<typeof setup>['send'], index = 0) =>
  (send.mock.calls[index]?.[0] as { input: Record<string, unknown> }).input;

describe('list', () => {
  test("queries the caller's documents only, newest first, and reads them back", async () => {
    const { send, store } = setup({ Items: [ITEM, OLDER_ITEM] });

    await expect(store.list(SUB)).resolves.toEqual([DOCUMENT, OLDER]);
    expectCommands(send, [QueryCommand, queryInput()]);
  });

  test('follows LastEvaluatedKey until the last page', async () => {
    const { send, store } = setup(
      { Items: [ITEM], LastEvaluatedKey: DOC_KEY },
      { Items: [OLDER_ITEM] },
    );

    await expect(store.list(SUB)).resolves.toEqual([DOCUMENT, OLDER]);
    expectCommands(send, [QueryCommand, queryInput()], [QueryCommand, queryInput(DOC_KEY)]);
  });

  test('an empty knowledge base', async () => {
    const { store } = setup({ Items: [] });

    await expect(store.list(SUB)).resolves.toEqual([]);
  });
});

describe('get', () => {
  test("reads one document from the caller's partition", async () => {
    const { send, store } = setup({ Item: ITEM });

    await expect(store.get(SUB, DOC_ID)).resolves.toEqual(DOCUMENT);
    expectCommands(send, [GetItemCommand, GET_DOCUMENT_INPUT]);
  });

  // The key holds the caller's sub, so another user's document ID also ends up here (S3-07).
  test('returns undefined for a document that is not there', async () => {
    const { store } = setup({});

    await expect(store.get(SUB, DOC_ID)).resolves.toBeUndefined();
  });
});

describe('usage', () => {
  test('reads the bytes and documents stored or reserved', async () => {
    const { send, store } = setup(usageItem(49_999_000, 3));

    await expect(store.usage(SUB)).resolves.toEqual({ usedBytes: 49_999_000, documentCount: 3 });
    expectCommands(send, [GetItemCommand, GET_USAGE_INPUT]);
  });

  test('is zero before the first upload', async () => {
    const { store } = setup({});

    await expect(store.usage(SUB)).resolves.toEqual({ usedBytes: 0, documentCount: 0 });
  });
});

describe('reserve', () => {
  test('adds the bytes and the document in one transaction, only within both limits', async () => {
    const { send, store } = setup({});

    await expect(store.reserve(SUB, DOCUMENT, LIMITS)).resolves.toBe('reserved');
    expectCommands(send, [TransactWriteItemsCommand, reserveInput('49999000')]);
  });

  // usedBytes <= :room is the same as usedBytes + size <= limit, without an addition in the
  // condition.
  test.each([
    [1, '49999999'],
    [1_000, '49999000'],
    [50_000_000, '0'], // fits only an empty knowledge base
  ])('a %i-byte file leaves room for %s bytes already used', async (size, room) => {
    const { send, store } = setup({});

    await store.reserve(SUB, { ...DOCUMENT, size }, LIMITS);
    const [update] = inputOf(send).TransactItems as {
      Update: { ExpressionAttributeValues: Record<string, unknown> };
    }[];
    expect(update!.Update.ExpressionAttributeValues[':room']).toEqual({ N: room });
  });

  test('a full knowledge base: the cap refuses it, and a second read says why', async () => {
    const { send, store } = setup(
      cancelled('ConditionalCheckFailed', 'None'),
      usageItem(49_999_500, 3),
    );

    await expect(store.reserve(SUB, DOCUMENT, LIMITS)).resolves.toBe('storage-full');
    expectCommands(
      send,
      [TransactWriteItemsCommand, reserveInput('49999000')],
      [GetItemCommand, GET_USAGE_INPUT],
    );
  });

  test('the 101st document is refused', async () => {
    const { store } = setup(cancelled('ConditionalCheckFailed', 'None'), usageItem(5_000, 100));

    await expect(store.reserve(SUB, DOCUMENT, LIMITS)).resolves.toBe('too-many-documents');
  });

  // Two uploads by the same user at once: DynamoDB cancels one. The service retries it (step 5).
  test.each([[['TransactionConflict', 'None']], [['None', 'TransactionConflict']]])(
    'a conflict (%j) is reported, without a second read',
    async (codes) => {
      const { send, store } = setup(cancelled(...codes));

      await expect(store.reserve(SUB, DOCUMENT, LIMITS)).resolves.toBe('conflict');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  // A UUID v7 collision. It can't happen in practice, so it's a bug, and a 500.
  test('an ID already taken (reason 1) is passed on', async () => {
    const failure = cancelled('None', 'ConditionalCheckFailed');
    const { store } = setup(failure);

    await expect(store.reserve(SUB, DOCUMENT, LIMITS)).rejects.toBe(failure);
  });

  test('passes on any other error', async () => {
    const failure = new Error('throttled');
    const { store } = setup(failure);

    await expect(store.reserve(SUB, DOCUMENT, LIMITS)).rejects.toBe(failure);
  });

  // The SDK reuses a command's token on its own retries, so a lost response can't reserve twice.
  // Each new call is a new reservation, so it needs a new token.
  test('every call has its own idempotency token', async () => {
    const { send, store } = setup({}, {});

    await store.reserve(SUB, DOCUMENT, LIMITS);
    await store.reserve(SUB, DOCUMENT, LIMITS);
    expect(inputOf(send, 0).ClientRequestToken).not.toBe(inputOf(send, 1).ClientRequestToken);
  });
});

describe('markUploaded', () => {
  test('marks a reserved document as uploaded', async () => {
    const { send, store } = setup({});

    await expect(store.markUploaded(SUB, DOC_ID)).resolves.toBeUndefined();
    expectCommands(send, [UpdateItemCommand, MARK_UPLOADED_INPUT]);
  });

  // Two GETs at once both see the file arrive. The second finds it already UPLOADED.
  test('a failed condition is fine: already marked, or deleted', async () => {
    const { store } = setup(conditionFailed());

    await expect(store.markUploaded(SUB, DOC_ID)).resolves.toBeUndefined();
  });

  test('passes on any other error', async () => {
    const failure = new Error('throttled');
    const { store } = setup(failure);

    await expect(store.markUploaded(SUB, DOC_ID)).rejects.toBe(failure);
  });
});

describe('extendDeadline', () => {
  test('moves the deadline of a reserved document', async () => {
    const { send, store } = setup({});

    await expect(store.extendDeadline(SUB, DOC_ID, DEADLINE)).resolves.toBe(true);
    expectCommands(send, [UpdateItemCommand, EXTEND_INPUT]);
  });

  test('returns false once it is uploaded, released, or deleted', async () => {
    const { store } = setup(conditionFailed());

    await expect(store.extendDeadline(SUB, DOC_ID, DEADLINE)).resolves.toBe(false);
  });

  test('passes on any other error', async () => {
    const failure = new Error('throttled');
    const { store } = setup(failure);

    await expect(store.extendDeadline(SUB, DOC_ID, DEADLINE)).rejects.toBe(failure);
  });
});

describe('remove', () => {
  test('a delete removes the item and frees its bytes in one transaction', async () => {
    const { send, store } = setup({});

    await expect(store.remove(SUB, DOCUMENT, false)).resolves.toBe('removed');
    expectCommands(send, [TransactWriteItemsCommand, DELETE_INPUT]);
  });

  test('a release does the same, only while the upload is still RESERVED', async () => {
    const { send, store } = setup({});

    await expect(store.remove(SUB, DOCUMENT, true)).resolves.toBe('removed');
    expectCommands(send, [TransactWriteItemsCommand, RELEASE_INPUT]);
  });

  // Two requests remove the same document at once. The second changes nothing: no double free.
  test.each([
    ['a delete', false],
    ['a release', true],
  ])('%s of a document already gone frees nothing', async (_, onlyIfReserved) => {
    const { store } = setup(cancelled('ConditionalCheckFailed', 'None'));

    await expect(store.remove(SUB, DOCUMENT, onlyIfReserved)).resolves.toBe('gone');
  });

  test.each([[['TransactionConflict', 'None']], [['None', 'TransactionConflict']]])(
    'a conflict (%j) is reported',
    async (codes) => {
      const { store } = setup(cancelled(...codes));

      await expect(store.remove(SUB, DOCUMENT, false)).resolves.toBe('conflict');
    },
  );

  // A document item without a usage item can't happen: they are written together. So a bug.
  test('a missing usage item (reason 1) is passed on', async () => {
    const failure = cancelled('None', 'ConditionalCheckFailed');
    const { store } = setup(failure);

    await expect(store.remove(SUB, DOCUMENT, false)).rejects.toBe(failure);
  });

  test('passes on any other error', async () => {
    const failure = new Error('throttled');
    const { store } = setup(failure);

    await expect(store.remove(SUB, DOCUMENT, false)).rejects.toBe(failure);
  });
});

// keys.ts refuses these, so a wrong value can't reach another user's partition, and nothing is sent.
describe('refuses a bad sub or ID before any call', () => {
  const BAD_SUB = 'alice@gmail.com';
  const BAD_ID = `../${DOC_ID}`;

  test.each<[string, (store: DocumentStore) => Promise<unknown>]>([
    ['list', (store) => store.list(BAD_SUB)],
    ['get', (store) => store.get(BAD_SUB, DOC_ID)],
    ['usage', (store) => store.usage(BAD_SUB)],
    ['reserve', (store) => store.reserve(BAD_SUB, DOCUMENT, LIMITS)],
    ['markUploaded', (store) => store.markUploaded(BAD_SUB, DOC_ID)],
    ['extendDeadline', (store) => store.extendDeadline(BAD_SUB, DOC_ID, DEADLINE)],
    ['remove', (store) => store.remove(BAD_SUB, DOCUMENT, false)],
  ])('%s: a bad sub', async (_, call) => {
    const { send, store } = setup();

    await expect(call(store)).rejects.toThrow('Invalid sub for a data table key');
    expect(send).not.toHaveBeenCalled();
  });

  test.each<[string, (store: DocumentStore) => Promise<unknown>]>([
    ['get', (store) => store.get(SUB, BAD_ID)],
    ['reserve', (store) => store.reserve(SUB, { ...DOCUMENT, id: BAD_ID }, LIMITS)],
    ['markUploaded', (store) => store.markUploaded(SUB, BAD_ID)],
    ['extendDeadline', (store) => store.extendDeadline(SUB, BAD_ID, DEADLINE)],
    ['remove', (store) => store.remove(SUB, { ...DOCUMENT, id: BAD_ID }, false)],
  ])('%s: a bad document ID', async (_, call) => {
    const { send, store } = setup();

    await expect(call(store)).rejects.toThrow('Invalid document ID for a data table key');
    expect(send).not.toHaveBeenCalled();
  });
});

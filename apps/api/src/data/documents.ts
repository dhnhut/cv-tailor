import { randomUUID } from 'node:crypto';
import {
  type AttributeValue,
  ConditionalCheckFailedException,
  GetItemCommand,
  QueryCommand,
  TransactionCanceledException,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { DocumentType } from '@cv-tailor/contracts';
import {
  ATTRIBUTES,
  ENTITY,
  KB_DOCUMENT_PREFIX,
  kbDocumentKey,
  type Key,
  storageUsageKey,
  userPartition,
} from './keys.ts';
import type { DynamoSend } from './profiles.ts';

export type UploadState = 'RESERVED' | 'UPLOADED';

export interface StoredDocument {
  readonly id: string;
  readonly name: string;
  readonly type: DocumentType;
  readonly size: number;
  readonly sha256: string; // lowercase hex
  readonly objectKey: string;
  readonly uploadState: UploadState;
  readonly uploadDeadline: string; // ISO; a RESERVED item still without its object after this is released
  readonly createdAt: string;
}
export interface StorageUsage {
  readonly usedBytes: number;
  readonly documentCount: number;
}
export interface Limits {
  readonly maxBytes: number;
  readonly maxDocuments: number;
}
export type ReserveOutcome = 'reserved' | 'storage-full' | 'too-many-documents' | 'conflict';
export type RemoveOutcome = 'removed' | 'gone' | 'conflict';

export interface DocumentStore {
  list(sub: string): Promise<StoredDocument[]>; // newest first
  get(sub: string, id: string): Promise<StoredDocument | undefined>;
  usage(sub: string): Promise<StorageUsage>;
  reserve(sub: string, document: StoredDocument, limits: Limits): Promise<ReserveOutcome>;
  markUploaded(sub: string, id: string): Promise<void>;
  extendDeadline(sub: string, id: string, deadline: string): Promise<boolean>;
  // onlyIfReserved: a release of an upload that never arrived. Otherwise a delete.
  remove(sub: string, document: StoredDocument, onlyIfReserved: boolean): Promise<RemoveOutcome>;
}

const NAMES = {
  '#pk': ATTRIBUTES.pk,
  '#entity': ATTRIBUTES.entity,
  '#used': 'usedBytes',
  '#count': 'documentCount',
  '#state': 'uploadState',
  '#deadline': 'uploadDeadline',
};
const keyOf = ({ PK, SK }: Key) => ({ [ATTRIBUTES.pk]: { S: PK }, [ATTRIBUTES.sk]: { S: SK } });
const n = (value: number): AttributeValue => ({ N: String(value) });

const toItem = (sub: string, d: StoredDocument): Record<string, AttributeValue> => ({
  ...keyOf(kbDocumentKey(sub, d.id)),
  [ATTRIBUTES.entity]: { S: ENTITY.kbDocument },
  name: { S: d.name },
  type: { S: d.type },
  size: n(d.size),
  sha256: { S: d.sha256 },
  objectKey: { S: d.objectKey },
  uploadState: { S: d.uploadState },
  uploadDeadline: { S: d.uploadDeadline },
  createdAt: { S: d.createdAt },
});
const fromItem = (item: Record<string, AttributeValue>): StoredDocument => ({
  id: item[ATTRIBUTES.sk]!.S!.slice(KB_DOCUMENT_PREFIX.length),
  name: item.name!.S!,
  type: item.type!.S! as DocumentType,
  size: Number(item.size!.N),
  sha256: item.sha256!.S!,
  objectKey: item.objectKey!.S!,
  uploadState: item.uploadState!.S! as UploadState,
  uploadDeadline: item.uploadDeadline!.S!,
  createdAt: item.createdAt!.S!,
});

// TransactWriteItems isn't retried by the SDK when it's cancelled. Reason 0 is the first item.
const cancelled = (error: unknown) =>
  error instanceof TransactionCanceledException
    ? (error.CancellationReasons ?? []).map((r) => r.Code)
    : undefined;

export const dynamoDocumentStore = (client: DynamoSend, tableName: string): DocumentStore => {
  const usage = async (sub: string): Promise<StorageUsage> => {
    const { Item } = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: keyOf(storageUsageKey(sub)),
        ConsistentRead: true,
      }),
    );
    return {
      usedBytes: Number(Item?.usedBytes?.N ?? 0),
      documentCount: Number(Item?.documentCount?.N ?? 0),
    };
  };

  return {
    async list(sub) {
      const documents: StoredDocument[] = [];
      let start: Record<string, AttributeValue> | undefined;
      do {
        const page = await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
            ExpressionAttributeNames: { '#pk': ATTRIBUTES.pk, '#sk': ATTRIBUTES.sk },
            ExpressionAttributeValues: {
              ':pk': { S: userPartition(sub) },
              ':prefix': { S: KB_DOCUMENT_PREFIX },
            },
            ScanIndexForward: false, // UUID v7 IDs sort by time, so newest first (ADR-0006)
            ConsistentRead: true, // a list right after an upload shows it
            ExclusiveStartKey: start,
          }),
        );
        documents.push(...(page.Items ?? []).map(fromItem));
        start = page.LastEvaluatedKey;
      } while (start);
      return documents;
    },

    async get(sub, id) {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: keyOf(kbDocumentKey(sub, id)),
          ConsistentRead: true,
        }),
      );
      return Item ? fromItem(Item) : undefined;
    },

    usage,

    async reserve(sub, document, { maxBytes, maxDocuments }) {
      try {
        await client.send(
          new TransactWriteItemsCommand({
            // An SDK retry after a lost response is then a no-op, not a second reservation.
            ClientRequestToken: randomUUID(),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: keyOf(storageUsageKey(sub)),
                  UpdateExpression: 'SET #entity = :entity ADD #used :size, #count :one',
                  // KB-06. DynamoDB checks this and applies the update as one step, so two uploads at
                  // once can't both pass the cap.
                  ConditionExpression:
                    'attribute_not_exists(#used) OR (#used <= :room AND #count < :maxCount)',
                  ExpressionAttributeNames: {
                    '#entity': NAMES['#entity'],
                    '#used': NAMES['#used'],
                    '#count': NAMES['#count'],
                  },
                  ExpressionAttributeValues: {
                    ':entity': { S: ENTITY.storageUsage },
                    ':size': n(document.size),
                    ':one': n(1),
                    ':room': n(maxBytes - document.size),
                    ':maxCount': n(maxDocuments),
                  },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: toItem(sub, document),
                  ConditionExpression: 'attribute_not_exists(#pk)',
                  ExpressionAttributeNames: { '#pk': NAMES['#pk'] },
                },
              },
            ],
          }),
        );
        return 'reserved';
      } catch (error) {
        const reasons = cancelled(error);
        if (!reasons) throw error;
        if (reasons[0] === 'ConditionalCheckFailed') {
          // Which limit? A second read only chooses the message. The condition above was the check.
          return (await usage(sub)).documentCount >= maxDocuments
            ? 'too-many-documents'
            : 'storage-full';
        }
        if (reasons.includes('TransactionConflict')) return 'conflict';
        throw error;
      }
    },

    async markUploaded(sub, id) {
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: keyOf(kbDocumentKey(sub, id)),
            UpdateExpression: 'SET #state = :uploaded',
            ConditionExpression: '#state = :reserved',
            ExpressionAttributeNames: { '#state': NAMES['#state'] },
            ExpressionAttributeValues: {
              ':uploaded': { S: 'UPLOADED' },
              ':reserved': { S: 'RESERVED' },
            },
          }),
        );
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error; // already done, or deleted
      }
    },

    async extendDeadline(sub, id, deadline) {
      try {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: keyOf(kbDocumentKey(sub, id)),
            UpdateExpression: 'SET #deadline = :deadline',
            ConditionExpression: '#state = :reserved',
            ExpressionAttributeNames: {
              '#state': NAMES['#state'],
              '#deadline': NAMES['#deadline'],
            },
            ExpressionAttributeValues: {
              ':deadline': { S: deadline },
              ':reserved': { S: 'RESERVED' },
            },
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return false;
        throw error;
      }
    },

    async remove(sub, document, onlyIfReserved) {
      try {
        await client.send(
          new TransactWriteItemsCommand({
            ClientRequestToken: randomUUID(),
            TransactItems: [
              {
                Delete: {
                  TableName: tableName,
                  Key: keyOf(kbDocumentKey(sub, document.id)),
                  // The condition makes the second of two racing requests change nothing: no double free.
                  ConditionExpression: onlyIfReserved
                    ? 'attribute_exists(#pk) AND #state = :reserved'
                    : 'attribute_exists(#pk)',
                  ExpressionAttributeNames: onlyIfReserved
                    ? { '#pk': NAMES['#pk'], '#state': NAMES['#state'] }
                    : { '#pk': NAMES['#pk'] },
                  ExpressionAttributeValues: onlyIfReserved
                    ? { ':reserved': { S: 'RESERVED' } }
                    : undefined,
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: keyOf(storageUsageKey(sub)),
                  UpdateExpression: 'ADD #used :minusSize, #count :minusOne',
                  ConditionExpression: 'attribute_exists(#used)',
                  ExpressionAttributeNames: { '#used': NAMES['#used'], '#count': NAMES['#count'] },
                  ExpressionAttributeValues: {
                    ':minusSize': n(-document.size),
                    ':minusOne': n(-1),
                  },
                },
              },
            ],
          }),
        );
        return 'removed';
      } catch (error) {
        const reasons = cancelled(error);
        if (!reasons) throw error;
        if (reasons[0] === 'ConditionalCheckFailed') return 'gone';
        if (reasons.includes('TransactionConflict')) return 'conflict';
        throw error; // reason 1 failing means the usage item is missing: a bug, so a 500
      }
    },
  };
};

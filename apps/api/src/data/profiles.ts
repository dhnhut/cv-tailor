// The data table calls GET /me makes (S2-09). handlers/me/handler.ts calls ensureProfile once per
// request. The IAM policy in infra/modules/api/main.tf allows exactly GetItem and PutItem, on the
// data table only, so a new command here needs a policy change too.
import {
  ConditionalCheckFailedException,
  type DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { ATTRIBUTES, ENTITY, profileKey } from './keys.ts';

// Only the client's send method, so tests can pass { send: vi.fn() }.
export type DynamoSend = Pick<DynamoDBClient, 'send'>;

export type ProfileOutcome = 'existing' | 'created';

export interface ProfileStore {
  // Creates the caller's profile item if it doesn't exist yet. Never overwrites one.
  ensureProfile(sub: string, at: Date): Promise<ProfileOutcome>;
}

// PK in expressions goes through a placeholder, so no attribute name can clash with a
// DynamoDB reserved word.
const PK_NAME = { '#pk': ATTRIBUTES.pk };

// The profile is created on the caller's first GET /me (S2-09), not by a Cognito trigger: this
// covers every way a user is created (ADR-0009 §2), users who existed before S2-09, and a failed
// earlier attempt.
export const dynamoProfileStore = (client: DynamoSend, tableName: string): ProfileStore => ({
  async ensureProfile(sub, at) {
    const { PK, SK } = profileKey(sub); // throws before any call if sub isn't a lowercase UUID
    const key = { [ATTRIBUTES.pk]: { S: PK }, [ATTRIBUTES.sk]: { S: SK } };

    // 1. The common case: the profile exists. One eventually consistent read (half a read unit),
    //    returning only PK, because only existence matters. A read that misses an item written a
    //    moment ago is safe: step 2's condition stops it from overwriting.
    const found = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: key,
        ProjectionExpression: '#pk',
        ExpressionAttributeNames: PK_NAME,
      }),
    );
    if (found.Item) return 'existing';

    // 2. The first call: create it, unless another call has just done so.
    try {
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: {
            ...key,
            [ATTRIBUTES.entity]: { S: ENTITY.profile },
            createdAt: { S: at.toISOString() }, // always UTC
          },
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: PK_NAME,
        }),
      );
      return 'created';
    } catch (error) {
      // A concurrent first call (two tabs opened at once) created it first. Its item is the
      // profile, with the earlier createdAt.
      if (error instanceof ConditionalCheckFailedException) return 'existing';
      throw error;
    }
  },
});

import {
  ConditionalCheckFailedException,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { describe, expect, test, vi } from 'vitest';
import { dynamoProfileStore } from '../../src/data/profiles.ts';

// The exact DynamoDB requests GET /me sends (S2-09). The IAM policy in infra/lib/api-stack.ts
// allows GetItem and PutItem only, so a new command here needs a policy change too. Inputs are
// written out literally, so a changed key format, attribute, or condition fails here.

const TABLE = 'cv-tailor-test-data';
const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
const AT = new Date('2026-10-03T09:15:00.000Z');
const KEY = { PK: { S: `USER#${SUB}` }, SK: { S: 'PROFILE' } };

const GET_INPUT = {
  TableName: TABLE,
  Key: KEY,
  ProjectionExpression: '#pk',
  ExpressionAttributeNames: { '#pk': 'PK' },
};
const PUT_INPUT = {
  TableName: TABLE,
  Item: { ...KEY, Entity: { S: 'Profile' }, createdAt: { S: '2026-10-03T09:15:00.000Z' } },
  ConditionExpression: 'attribute_not_exists(#pk)',
  ExpressionAttributeNames: { '#pk': 'PK' },
};

// What DynamoDB throws when the condition fails.
const conditionFailed = () =>
  new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });

// send answers each call in turn: an Error rejects, anything else resolves.
const setup = (...responses: unknown[]) => {
  const send = vi.fn<(command: unknown) => Promise<unknown>>();
  for (const response of responses) {
    if (response instanceof Error) send.mockRejectedValueOnce(response);
    else send.mockResolvedValueOnce(response);
  }
  return { send, store: dynamoProfileStore({ send }, TABLE) };
};

// The commands sent, in order: each one's class and its exact input.
type CommandClass = abstract new (...args: never[]) => { input: unknown };
const expectCommands = (
  send: ReturnType<typeof setup>['send'],
  ...expected: [CommandClass, unknown][]
) => {
  expect(send).toHaveBeenCalledTimes(expected.length);
  expected.forEach(([type, input], index) => {
    const command = send.mock.calls[index]?.[0];
    expect(command).toBeInstanceOf(type);
    expect((command as { input: unknown }).input).toEqual(input);
  });
};

describe('ensureProfile', () => {
  test('reads once and writes nothing when the profile exists', async () => {
    const { send, store } = setup({ Item: { PK: KEY.PK } });

    await expect(store.ensureProfile(SUB, AT)).resolves.toBe('existing');
    expectCommands(send, [GetItemCommand, GET_INPUT]);
  });

  test('creates the profile on the first call, only if no item has this key', async () => {
    const { send, store } = setup({}, {});

    await expect(store.ensureProfile(SUB, AT)).resolves.toBe('created');
    expectCommands(send, [GetItemCommand, GET_INPUT], [PutItemCommand, PUT_INPUT]);
  });

  // Two first calls at once: both reads miss, and the condition lets only one write succeed.
  test('treats a failed condition as existing: a concurrent call created it first', async () => {
    const { send, store } = setup({}, conditionFailed());

    await expect(store.ensureProfile(SUB, AT)).resolves.toBe('existing');
    expectCommands(send, [GetItemCommand, GET_INPUT], [PutItemCommand, PUT_INPUT]);
  });

  test('passes on any other write error', async () => {
    const failure = new Error('throttled');
    const { store } = setup({}, failure);

    await expect(store.ensureProfile(SUB, AT)).rejects.toBe(failure);
  });

  test('passes on a read error, and writes nothing', async () => {
    const failure = new Error('throttled');
    const { send, store } = setup(failure);

    await expect(store.ensureProfile(SUB, AT)).rejects.toBe(failure);
    expectCommands(send, [GetItemCommand, GET_INPUT]);
  });

  // keys.ts refuses these, so a wrong value can't reach another user's partition.
  test.each([
    ['an email address', 'alice@gmail.com'],
    ['an uppercase UUID', SUB.toUpperCase()],
    ['an empty string', ''],
  ])('refuses %s as a sub, before any call', async (_, sub) => {
    const { send, store } = setup();

    await expect(store.ensureProfile(sub, AT)).rejects.toThrow('Invalid sub for a data table key');
    expect(send).not.toHaveBeenCalled();
  });
});

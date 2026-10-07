import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import { expect, vi } from 'vitest';

// Fakes for tests of the modules that call AWS. A store takes { send }, and the bucket test spies on
// the S3 client's send, so these replace the network without any AWS call.

// send answers each call in turn: an Error rejects, anything else resolves.
export const fakeSend = (...responses: unknown[]) => {
  const send = vi.fn<(command: unknown) => Promise<unknown>>();
  for (const response of responses) {
    if (response instanceof Error) send.mockRejectedValueOnce(response);
    else send.mockResolvedValueOnce(response);
  }
  return send;
};
export type FakeSend = ReturnType<typeof fakeSend>;

// The commands sent, in order: each one's class and its exact input.
type CommandClass = abstract new (...args: never[]) => { input: unknown };
export const expectCommands = (send: FakeSend, ...expected: [CommandClass, unknown][]) => {
  expect(send).toHaveBeenCalledTimes(expected.length);
  expected.forEach(([type, input], index) => {
    const command = send.mock.calls[index]?.[0];
    expect(command).toBeInstanceOf(type);
    expect((command as { input: unknown }).input).toEqual(input);
  });
};

// What DynamoDB throws when a single item's condition fails.
export const conditionFailed = () =>
  new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });

// What DynamoDB throws when it cancels a transaction: one reason per item, in order, and "None"
// for an item that was fine.
export const cancelled = (...codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

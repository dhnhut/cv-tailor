import { expect, test } from 'vitest';
import { handler } from '../src/handlers/health.js';

test('health check returns correct status', async () => {
  const result = await handler();

  expect(result).toEqual({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  });
});

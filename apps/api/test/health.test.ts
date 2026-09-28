import { expect, test } from 'vitest';
import { handler } from '../src/handlers/health.js';
import { HealthResponse } from '@cv-tailor/contracts';

test('health check returns correct status', async () => {
  const result = await handler();

  expect(result.statusCode).toBe(200);
  expect(result.headers).toEqual({ 'content-type': 'application/json' });
  // Runtime half of the guarantee: the real JSON body must satisfy the contract.
  expect(HealthResponse.parse(JSON.parse(result.body))).toEqual({ status: 'ok' });
});

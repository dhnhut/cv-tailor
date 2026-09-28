import { expect, test } from 'vitest';
import { contracts, HealthResponse } from '../src/index.ts';

test('HealthResponse is registered as a contract', () => {
  expect(contracts.get(HealthResponse)).toEqual({ id: 'HealthResponse' });
});

test('accepts valid health response', () => {
  const validResponse = { status: 'ok' };
  expect(HealthResponse.parse(validResponse)).toEqual(validResponse);
});

test('rejects wrong status value', () => {
  const invalidResponse = { status: 'error' };
  const result = HealthResponse.safeParse(invalidResponse);
  expect(result.success).toBe(false);
  expect(result.error?.issues).toMatchObject([{ code: 'invalid_value', path: ['status'] }]);
});

test('rejects missing status field', () => {
  const missingStatusResponse = {};
  const result = HealthResponse.safeParse(missingStatusResponse);
  expect(result.success).toBe(false);
  expect(result.error?.issues).toMatchObject([{ code: 'invalid_value', path: ['status'] }]);
});

test('rejects unknown keys (strictObject, matches Pydantic extra="forbid")', () => {
  const result = HealthResponse.safeParse({ status: 'ok', extra: 'field' });
  expect(result.success).toBe(false);
  expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', keys: ['extra'] }]);
});

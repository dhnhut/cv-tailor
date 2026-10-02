import { expect, test } from 'vitest';
import { contracts, WebConfig } from '../src/index.ts';

test('accepts the settings CDK writes', () => {
  expect(WebConfig.parse({ environment: 'dev' })).toEqual({ environment: 'dev' });
  expect(WebConfig.parse({ environment: 'stag' })).toEqual({ environment: 'stag' });
  expect(WebConfig.parse({ environment: 'prod' })).toEqual({ environment: 'prod' });
});

test('rejects an unknown environment', () => {
  expect(WebConfig.safeParse({ environment: 'test' }).success).toBe(false);
});

test('rejects unknown keys', () => {
  expect(WebConfig.safeParse({ environment: 'dev', userPoolId: 'x' }).success).toBe(false);
});

// Registered contracts get JSON Schema and Pydantic files. Python never reads this one.
test('is not registered for code generation', () => {
  expect(contracts.get(WebConfig)).toBeUndefined();
});

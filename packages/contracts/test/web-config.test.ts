import { expect, test } from 'vitest';
import { contracts, WebConfig } from '../src/index.ts';

// What CDK writes for dev. The client ID has Cognito's usual shape: 26 lowercase letters and digits.
const VALID = {
  environment: 'dev',
  apiUrl: 'https://api.dev.cv.ikiwii.com',
  authUrl: 'https://auth.dev.cv.ikiwii.com',
  userPoolId: 'us-east-1_AbCdEf123',
  webClientId: '1example23456789abcdefghij',
} as const;

test('accepts the settings CDK writes', () => {
  for (const environment of ['dev', 'stag', 'prod'] as const) {
    expect(WebConfig.parse({ ...VALID, environment })).toEqual({ ...VALID, environment });
  }
});

test('rejects an unknown environment', () => {
  expect(WebConfig.safeParse({ ...VALID, environment: 'test' }).success).toBe(false);
});

// Both origins are HTTPS only, with no path: the web app builds URLs from them (S2-09, S2-10).
test.each(['apiUrl', 'authUrl'] as const)('rejects a bad %s', (key) => {
  const host = new URL(VALID[key]).host;
  for (const value of [
    undefined,
    `http://${host}`,
    host,
    `https://${host}/v1`,
    `https://${host}/`,
  ]) {
    expect(WebConfig.safeParse({ ...VALID, [key]: value }).success).toBe(false);
  }
});

test('accepts a pool ID from any region', () => {
  expect(WebConfig.safeParse({ ...VALID, userPoolId: 'ap-southeast-2_Xyz9' }).success).toBe(true);
});

test.each([
  ['a missing pool ID', { userPoolId: undefined }],
  ['a pool ID without a region', { userPoolId: 'AbCdEf123' }],
  ['a pool ID without an underscore', { userPoolId: 'us-east-1-AbCdEf123' }],
  ['a pool ID with nothing after the region', { userPoolId: 'us-east-1_' }],
  ['a missing client ID', { webClientId: undefined }],
  ['an empty client ID', { webClientId: '' }],
  ['a client ID with a space', { webClientId: 'abc def' }],
  ['a client ID longer than 128 characters', { webClientId: 'a'.repeat(129) }],
])('rejects %s', (_, override) => {
  expect(WebConfig.safeParse({ ...VALID, ...override }).success).toBe(false);
});

// A public client has no secret. If one ever reached config.json, every visitor could read it.
test('rejects unknown keys, such as a client secret', () => {
  expect(WebConfig.safeParse({ ...VALID, clientSecret: 'x' }).success).toBe(false);
});

// Registered contracts get JSON Schema and Pydantic files. Python never reads this one.
test('is not registered for code generation', () => {
  expect(contracts.get(WebConfig)).toBeUndefined();
});

import { expect, test } from 'vitest';
import { contracts, WebConfig } from '../src/index.ts';

const API_URL = 'https://api.dev.cv.ikiwii.com';

test('accepts the settings CDK writes', () => {
  for (const environment of ['dev', 'stag', 'prod'] as const) {
    expect(WebConfig.parse({ environment, apiUrl: API_URL })).toEqual({
      environment,
      apiUrl: API_URL,
    });
  }
});

test('rejects an unknown environment', () => {
  expect(WebConfig.safeParse({ environment: 'test', apiUrl: API_URL }).success).toBe(false);
});

// The API is HTTPS only, and an origin only: the web app builds request URLs from it (S2-09).
test.each([
  ['a missing apiUrl', { environment: 'dev' }],
  ['an http apiUrl', { environment: 'dev', apiUrl: 'http://api.dev.cv.ikiwii.com' }],
  ['an apiUrl without a scheme', { environment: 'dev', apiUrl: 'api.dev.cv.ikiwii.com' }],
  ['an apiUrl with a path', { environment: 'dev', apiUrl: 'https://api.dev.cv.ikiwii.com/v1' }],
  [
    'an apiUrl with a trailing slash',
    { environment: 'dev', apiUrl: 'https://api.dev.cv.ikiwii.com/' },
  ],
])('rejects %s', (_, config) => {
  expect(WebConfig.safeParse(config).success).toBe(false);
});

test('rejects unknown keys', () => {
  expect(
    WebConfig.safeParse({ environment: 'dev', apiUrl: API_URL, userPoolId: 'x' }).success,
  ).toBe(false);
});

// Registered contracts get JSON Schema and Pydantic files. Python never reads this one.
test('is not registered for code generation', () => {
  expect(contracts.get(WebConfig)).toBeUndefined();
});

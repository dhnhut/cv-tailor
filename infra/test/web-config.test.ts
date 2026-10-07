import { describe, expect, test } from 'vitest';
import { main, webConfigFrom } from '../scripts/web-config.ts';

// /config.json from the workload stack's outputs (S3-15, ADR-0013 §7). Values are in the shape of
// `tofu output -json`.

const OUTPUTS = {
  environment: { value: 'dev' },
  api_url: { value: 'https://api.dev.cv.ikiwii.com' },
  auth_url: { value: 'https://auth.dev.cv.ikiwii.com' },
  user_pool_id: { value: 'us-east-1_AbC123' },
  web_client_id: { value: 'abc123def456' },
  site_bucket: { value: 'cv-tailor-dev-web-111111111111' },
};

describe('webConfigFrom', () => {
  test('builds the five settings the web app reads, and nothing else', () => {
    expect(webConfigFrom(OUTPUTS)).toEqual({
      environment: 'dev',
      apiUrl: 'https://api.dev.cv.ikiwii.com',
      authUrl: 'https://auth.dev.cv.ikiwii.com',
      userPoolId: 'us-east-1_AbC123',
      webClientId: 'abc123def456',
    });
  });

  test('refuses outputs from a stack that was never applied', () => {
    const withoutPool = Object.fromEntries(
      Object.entries(OUTPUTS).filter(([name]) => name !== 'user_pool_id'),
    );

    expect(() => webConfigFrom(withoutPool)).toThrow('no "user_pool_id" output');
  });

  test('refuses a value the contract rejects, before anything is uploaded', () => {
    expect(() =>
      webConfigFrom({ ...OUTPUTS, api_url: { value: 'https://api.dev.cv.ikiwii.com/v1' } }),
    ).toThrow('Must be an origin, with no path');
  });
});

describe('main', () => {
  test('turns `tofu output -json` text into config.json text', () => {
    expect(main(JSON.stringify(OUTPUTS))).toBe(
      `${JSON.stringify(webConfigFrom(OUTPUTS), null, 2)}\n`,
    );
  });
});

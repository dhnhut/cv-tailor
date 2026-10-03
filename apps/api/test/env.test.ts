import { expect, test } from 'vitest';
import { requiredEnv } from '../src/env.ts';

test('returns a setting that is present', () => {
  expect(requiredEnv('TABLE_NAME', { TABLE_NAME: 'cv-tailor-dev-data' })).toBe(
    'cv-tailor-dev-data',
  );
});

test.each([
  ['missing', {}],
  ['empty', { TABLE_NAME: '' }],
])('throws when the setting is %s', (_, env) => {
  expect(() => requiredEnv('TABLE_NAME', env)).toThrow('Missing environment variable TABLE_NAME');
});

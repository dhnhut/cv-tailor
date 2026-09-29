import { describe, expect, test } from 'vitest';
import {
  PLACEHOLDER_ACCOUNT_ID,
  PLACEHOLDER_FLAG,
  loadEnvironments,
} from '../config/environments.ts';

const VALID_ENV = {
  CVT_DEV_ACCOUNT_ID: '111111111111',
  CVT_STAG_ACCOUNT_ID: '222222222222',
  CVT_PROD_ACCOUNT_ID: '333333333333',
};

describe('loadEnvironments', () => {
  test('builds dev, stag and prod in us-east-1 from the account ID variables', () => {
    expect(loadEnvironments(VALID_ENV)).toEqual([
      { name: 'dev', account: '111111111111', region: 'us-east-1' },
      { name: 'stag', account: '222222222222', region: 'us-east-1' },
      { name: 'prod', account: '333333333333', region: 'us-east-1' },
    ]);
  });

  test('names every missing variable in one error', () => {
    expect(() => loadEnvironments({})).toThrow(
      /CVT_DEV_ACCOUNT_ID, CVT_STAG_ACCOUNT_ID, CVT_PROD_ACCOUNT_ID/,
    );
  });

  test.each(['12345678901', '1234567890123', '12345678901a', ''])(
    'rejects the malformed account ID %j',
    (account) => {
      expect(() => loadEnvironments({ ...VALID_ENV, CVT_STAG_ACCOUNT_ID: account })).toThrow(
        /: CVT_STAG_ACCOUNT_ID\./,
      );
    },
  );

  test('uses the placeholder account for every environment in placeholder mode', () => {
    const configs = loadEnvironments({ [PLACEHOLDER_FLAG]: '1' });

    expect(configs.map((c) => c.name)).toEqual(['dev', 'stag', 'prod']);
    for (const config of configs) expect(config.account).toBe(PLACEHOLDER_ACCOUNT_ID);
  });
});

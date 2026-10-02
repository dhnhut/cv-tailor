import { describe, expect, test } from 'vitest';
import {
  DNS,
  HOST,
  PLACEHOLDER_ACCOUNT_ID,
  PLACEHOLDER_ALERT_EMAIL,
  PLACEHOLDER_FLAG,
  REGION,
  loadEnvironments,
} from '../config/environments.ts';
import { TEST_ENV } from './test-app.ts';

const EMAIL = TEST_ENV.CVT_ALERT_EMAIL;

describe('loadEnvironments', () => {
  test('builds dev, stag and prod in us-east-1 from the environment variables', () => {
    expect(loadEnvironments(TEST_ENV)).toEqual([
      {
        name: 'dev',
        account: '111111111111',
        region: REGION,
        host: 'dev.cv.ikiwii.com',
        alertEmail: EMAIL,
        monthlyBudgetUsd: 5,
        dns: DNS.dev,
      },
      {
        name: 'stag',
        account: '222222222222',
        region: REGION,
        host: 'stag.cv.ikiwii.com',
        alertEmail: EMAIL,
        monthlyBudgetUsd: 5,
      },
      {
        name: 'prod',
        account: '333333333333',
        region: REGION,
        host: 'cv.ikiwii.com',
        alertEmail: EMAIL,
        monthlyBudgetUsd: 10,
        dns: DNS.prod,
      },
    ]);
  });

  test('leaves the dns key out, not undefined, for an environment without a DNS stage', () => {
    const stag = loadEnvironments(TEST_ENV).find((c) => c.name === 'stag');

    expect(stag).not.toHaveProperty('dns');
  });

  test('names every missing variable, with its rule, in one error', () => {
    expect(() => loadEnvironments({})).toThrow(
      'Missing or invalid settings: ' +
        'CVT_DEV_ACCOUNT_ID (expected 12 digits), ' +
        'CVT_STAG_ACCOUNT_ID (expected 12 digits), ' +
        'CVT_PROD_ACCOUNT_ID (expected 12 digits), ' +
        'CVT_ALERT_EMAIL (expected an email address).',
    );
  });

  // The trailing "\." proves the variable under test is the only problem named.
  test.each(['12345678901', '1234567890123', '12345678901a', ''])(
    'rejects the malformed account ID %j',
    (account) => {
      expect(() => loadEnvironments({ ...TEST_ENV, CVT_STAG_ACCOUNT_ID: account })).toThrow(
        /: CVT_STAG_ACCOUNT_ID \(expected 12 digits\)\./,
      );
    },
  );

  test.each([undefined, '', 'not-an-email', 'a@b', 'a b@example.com'])(
    'rejects the missing or malformed alert email %j',
    (email) => {
      expect(() => loadEnvironments({ ...TEST_ENV, CVT_ALERT_EMAIL: email })).toThrow(
        /: CVT_ALERT_EMAIL \(expected an email address\)\./,
      );
    },
  );

  test('uses placeholders for accounts and email, and the real budgets, in placeholder mode', () => {
    const configs = loadEnvironments({ [PLACEHOLDER_FLAG]: '1' });

    expect(configs.map((c) => c.name)).toEqual(['dev', 'stag', 'prod']);
    expect(configs.map((c) => c.monthlyBudgetUsd)).toEqual([5, 5, 10]);
    for (const config of configs) {
      expect(config.account).toBe(PLACEHOLDER_ACCOUNT_ID);
      expect(config.alertEmail).toBe(PLACEHOLDER_ALERT_EMAIL);
    }
  });
});

describe('DNS settings (S2-03, ADR-0008)', () => {
  test('each environment has its own host under cv.ikiwii.com', () => {
    expect(HOST).toEqual({
      dev: 'dev.cv.ikiwii.com',
      stag: 'stag.cv.ikiwii.com',
      prod: 'cv.ikiwii.com',
    });
  });

  test('dev and prod have a DNS stage, and only dev has a certificate', () => {
    expect(Object.keys(DNS).sort()).toEqual(['dev', 'prod']);
    expect(DNS.dev?.certificate).toBe(true);
    expect(DNS.prod?.certificate).toBe(false);
  });

  // Name servers are copied by hand from a stack output (deploy runbook, step 3),
  // so a typo or a zone delegated from the wrong parent fails here.
  test.each(Object.entries(DNS))(
    'every delegation from %s is a child zone with four Route 53 name servers',
    (name, dns) => {
      for (const { zoneName, nameServers } of dns.delegations) {
        expect(zoneName.endsWith(`.${HOST[name as keyof typeof HOST]}`)).toBe(true);
        expect(nameServers).toHaveLength(4);
        for (const nameServer of nameServers) {
          expect(nameServer).toMatch(/^ns-\d+\.awsdns-\d+\.(com|net|org|co\.uk)\.?$/);
        }
      }
    },
  );
});

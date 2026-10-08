import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// What every stack must declare (ADR-0002, ADR-0013 §3–4). `tofu test` can't see provider and
// backend blocks, so these are checked in the files' text. The CDK app's stage tests checked the
// same before S3-15.

const INFRA = new URL('../', import.meta.url);
const STACKS = ['access', 'baseline', 'bootstrap', 'dns', 'workload'];
const ENCRYPTED = STACKS.filter((stack) => stack !== 'bootstrap');

const read = (path: string) => readFileSync(new URL(path, INFRA), 'utf8');

// Every OpenTofu file in modules/ and stacks/, without working directories and build output.
const hclFiles = ['modules', 'stacks'].flatMap((dir) =>
  readdirSync(new URL(`${dir}/`, INFRA), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(tf|tftest\.hcl)$/.test(path) && !/(^|\/)\.(terraform|build)/.test(path))
    .map((path) => `${dir}/${path}`),
);

test('the stacks are the five in ADR-0013', () => {
  expect(readdirSync(new URL('stacks/', INFRA)).sort()).toEqual(STACKS);
});

describe.each(STACKS)('stacks/%s', (stack) => {
  test('pins us-east-1 and its own account, and tags what it creates', () => {
    const providers = read(`stacks/${stack}/providers.tf`);

    expect(providers).toMatch(/^\s*region\s*=\s*"us-east-1"/m);
    expect(providers).toMatch(/^\s*allowed_account_ids\s*=\s*\[var\.account_id\]/m);
    expect(providers).toMatch(new RegExp(`^\\s*Stack\\s*=\\s*"${stack}"`, 'm'));
  });

  test('keeps its state in S3, in us-east-1, with native locking', () => {
    expect(read(`stacks/${stack}/versions.tf`)).toMatch(
      /backend "s3" \{\s*region\s*=\s*"us-east-1"\s*use_lockfile\s*=\s*true\s*\}/,
    );
  });
});

test.each(ENCRYPTED)(
  'stacks/%s encrypts state and plans with the state key, and refuses plain text',
  (stack) => {
    const versions = read(`stacks/${stack}/versions.tf`);

    expect(versions).toMatch(/kms_key_id\s*=\s*"alias\/cv-tailor-tfstate"/);
    expect(versions.match(/^\s*enforced\s*=\s*true/gm)).toHaveLength(2); // state and plan
  },
);

test('stacks/bootstrap has no encryption block, because it creates the key', () => {
  expect(read('stacks/bootstrap/versions.tf')).not.toMatch(/^\s*encryption\s*\{/m);
});

test('no OpenTofu file names a region other than us-east-1', () => {
  const region =
    /\b(?:us|eu|ap|sa|ca|me|af|il|mx)-(?:gov-)?(?:north|south|east|west|central)+-\d\b/g;
  const others = hclFiles.flatMap((path) =>
    [...read(path).matchAll(region)]
      .map(([match]) => match)
      .filter((match) => match !== 'us-east-1'),
  );

  expect(hclFiles.length).toBeGreaterThan(40); // the walk found the files
  expect(others).toEqual([]);
});

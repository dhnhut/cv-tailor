import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ACL_IDENTITY_DOMAIN, aclFileBody, aclIdentity } from '../../src/knowledge-base/acl.ts';

// The ACL identity (ADR-0007). The fixture is shared with S3-10's Python test, so both languages
// build the same string from a sub and refuse the same bad values.

interface Fixture {
  readonly domain: string;
  readonly cases: readonly { readonly sub: string; readonly identity: string }[];
  readonly refused: readonly string[];
}
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../packages/contracts/fixtures/acl-identity.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';

describe('aclIdentity', () => {
  test('uses the shared domain', () => {
    expect(ACL_IDENTITY_DOMAIN).toBe(fixture.domain);
  });

  // .invalid is reserved (RFC 2606): no mail can ever reach it, so the identity can never be a
  // real person's address.
  test('the domain can never receive mail', () => {
    expect(ACL_IDENTITY_DOMAIN.endsWith('.invalid')).toBe(true);
  });

  test.each(fixture.cases)('$sub → $identity', ({ sub, identity }) => {
    expect(aclIdentity(sub)).toBe(identity);
  });

  test.each(fixture.refused)('refuses %j, and never repeats it in the error', (sub) => {
    expect(() => aclIdentity(sub)).toThrow(/^Invalid sub for an ACL identity$/);
  });
});

describe('aclFileBody', () => {
  // Byte for byte: one ALLOW entry for the owner and nobody else. Ingestion drops a document
  // whose ACL file it can't read, without naming it (S2-12).
  test('is the exact ACL file', () => {
    expect(aclFileBody(SUB)).toBe(
      `{"metadataAttributes":{},"accessControlList":[{"Name":"${SUB}@users.cv-tailor.invalid","Type":"USER","Access":"ALLOW"}]}`,
    );
  });

  test('refuses a bad sub before building anything', () => {
    expect(() => aclFileBody('alice@example.com')).toThrow(/^Invalid sub for an ACL identity$/);
  });
});

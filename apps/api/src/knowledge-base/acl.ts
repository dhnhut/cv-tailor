import { isSub } from '../data/keys.ts';

// The ACL identity (ADR-0007): a synthetic address built from the Cognito sub, never the real
// email. S3-10's Python function must build the same string. Both test against
// packages/contracts/fixtures/acl-identity.json.
export const ACL_IDENTITY_DOMAIN = 'users.cv-tailor.invalid';

export const aclIdentity = (sub: string): string => {
  if (!isSub(sub)) throw new Error('Invalid sub for an ACL identity');
  return `${sub}@${ACL_IDENTITY_DOMAIN}`;
};

// The <file>.metadata.json body: one ALLOW entry for the owner (S2-12 spike shape).
export const aclFileBody = (sub: string): string =>
  JSON.stringify({
    metadataAttributes: {},
    accessControlList: [{ Name: aclIdentity(sub), Type: 'USER', Access: 'ALLOW' }],
  });

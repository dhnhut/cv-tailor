import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Guards for the hand-applied Organization policies in infra/org (S1-05, ADR-0004 §6–7).
// AWS only validates them when they are applied, so this catches mistakes in CI first.

interface Statement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action?: string | string[];
  NotAction?: string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

interface PolicyDocument {
  Version: string;
  Statement: Statement[];
}

const SCP_MAX_CHARS = 5_120; // AWS Organizations quota for one SCP
const ALLOWED_REGIONS = ['us-east-1']; // ADR-0002
const BEDROCK_INFERENCE_ACTIONS = [
  'bedrock:InvokeModel',
  'bedrock:InvokeModelWithResponseStream',
  'bedrock:CreateModelInvocationJob',
];

const readText = (path: string): string =>
  readFileSync(new URL(`../org/${path}`, import.meta.url), 'utf8');

const readPolicy = (path: string): PolicyDocument => JSON.parse(readText(path)) as PolicyDocument;

const statement = (policy: PolicyDocument, sid: string): Statement => {
  const found = policy.Statement.find((s) => s.Sid === sid);
  if (!found) throw new Error(`statement ${sid} not found`);
  return found;
};

const actionsOf = (s: Statement): string[] => [s.Action ?? []].flat();

describe.each(['scps/baseline.json', 'scps/log-protection.json'])('SCP %s', (path) => {
  const policy = readPolicy(path);

  test('is a valid deny-only policy with unique Sids', () => {
    expect(policy.Version).toBe('2012-10-17');
    expect(policy.Statement.length).toBeGreaterThan(0);
    for (const s of policy.Statement) expect(s.Effect).toBe('Deny');

    const sids = policy.Statement.map((s) => s.Sid);
    expect(sids.every(Boolean)).toBe(true);
    expect(new Set(sids).size).toBe(sids.length);
  });

  test('fits the SCP size limit once minified', () => {
    expect(JSON.stringify(policy).length).toBeLessThanOrEqual(SCP_MAX_CHARS);
  });

  test('has no placeholders, so it can be applied as committed', () => {
    expect(readText(path)).not.toContain('${');
  });
});

describe('baseline SCP', () => {
  const policy = readPolicy('scps/baseline.json');

  test('denies leaving the Organization and closing the account', () => {
    expect(actionsOf(statement(policy, 'DenyLeaveOrgAndCloseAccount'))).toEqual(
      expect.arrayContaining(['organizations:LeaveOrganization', 'account:CloseAccount']),
    );
  });

  test('denies every non-global action outside the allowed regions', () => {
    const regionDeny = statement(policy, 'DenyOutsideAllowedRegions');

    expect(regionDeny.Condition?.StringNotEquals?.['aws:RequestedRegion']).toEqual(ALLOWED_REGIONS);
    // Bedrock inference is carved out here and limited by the Bedrock statement instead.
    expect(regionDeny.NotAction).toEqual(expect.arrayContaining(BEDROCK_INFERENCE_ACTIONS));
  });

  test('allows Bedrock inference outside the allowed regions only through us. and global. profiles', () => {
    const bedrockDeny = statement(
      policy,
      'DenyBedrockInferenceOutsideAllowedRegionsExceptUsAndGlobalProfiles',
    );

    expect(actionsOf(bedrockDeny)).toEqual(BEDROCK_INFERENCE_ACTIONS);
    expect(bedrockDeny.Condition?.StringNotEquals?.['aws:RequestedRegion']).toEqual(
      ALLOWED_REGIONS,
    );
    // Exact list, so allowing another profile type (for example eu.*) is a reviewed change.
    expect(bedrockDeny.Condition?.ArnNotLike?.['bedrock:InferenceProfileArn']).toEqual([
      'arn:aws:bedrock:*:*:inference-profile/us.*',
      'arn:aws:bedrock:*:*:inference-profile/global.*',
    ]);
  });

  test('denies turning off or filtering CloudTrail', () => {
    expect(actionsOf(statement(policy, 'ProtectCloudTrail'))).toEqual(
      expect.arrayContaining([
        'cloudtrail:StopLogging',
        'cloudtrail:DeleteTrail',
        'cloudtrail:UpdateTrail',
        'cloudtrail:PutEventSelectors',
      ]),
    );
  });
});

describe('CloudTrail bucket policy template', () => {
  test('renders to valid JSON with every placeholder filled', () => {
    const ids: Record<string, string> = {
      ORG_ID: 'o-abc123def4',
      MGMT_ACCOUNT_ID: '111111111111',
      LOG_ARCHIVE_ACCOUNT_ID: '222222222222',
    };
    const rendered = readText('cloudtrail/bucket-policy.json').replace(
      /\$\{(\w+)\}/g,
      (_, name: string) => ids[name] ?? `\${${name}}`,
    );

    expect(rendered).not.toContain('${');
    const policy = JSON.parse(rendered) as PolicyDocument;
    expect(policy.Version).toBe('2012-10-17');
  });
});

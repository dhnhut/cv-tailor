// Per-environment settings for the CDK app (S1-06).
// Account IDs are not committed (public repo, ADR-0004 §2). They come from
// CVT_<ENV>_ACCOUNT_ID, set in the shell or in infra/.env (see infra/.env.example).

export const REGION = 'us-east-1'; // single region, ADR-0002

export const ENVIRONMENT_NAMES = ['dev', 'stag', 'prod'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

export interface EnvironmentConfig {
  readonly name: EnvironmentName;
  readonly account: string;
  readonly region: typeof REGION;
}

// Synth-only mode for CI, which has no real account IDs. The placeholder never
// matches real credentials, so `cdk deploy` refuses to use it.
export const PLACEHOLDER_FLAG = 'CVT_PLACEHOLDER_ACCOUNTS';
export const PLACEHOLDER_ACCOUNT_ID = '000000000000';

const ACCOUNT_ID_PATTERN = /^\d{12}$/;

export const accountIdVar = (name: EnvironmentName): string =>
  `CVT_${name.toUpperCase()}_ACCOUNT_ID`;

export function loadEnvironments(
  env: Record<string, string | undefined> = process.env,
): EnvironmentConfig[] {
  const placeholder = env[PLACEHOLDER_FLAG] === '1';

  const invalid = ENVIRONMENT_NAMES.map(accountIdVar).filter(
    (variable) => !placeholder && !ACCOUNT_ID_PATTERN.test(env[variable] ?? ''),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Missing or invalid AWS account IDs (expected 12 digits): ${invalid.join(', ')}. ` +
        `Set them in the shell or in infra/.env (see infra/.env.example), ` +
        `or set ${PLACEHOLDER_FLAG}=1 to synthesise with placeholders.`,
    );
  }

  return ENVIRONMENT_NAMES.map((name) => ({
    name,
    account: placeholder ? PLACEHOLDER_ACCOUNT_ID : (env[accountIdVar(name)] as string),
    region: REGION,
  }));
}

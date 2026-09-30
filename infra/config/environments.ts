// Per-environment settings for the CDK app (S1-06, S1-09).
// Account IDs and the alert email are not committed (public repo, ADR-0004 §2). They come from
// CVT_<ENV>_ACCOUNT_ID and CVT_ALERT_EMAIL, set in the shell or in infra/.env (see infra/.env.example).

export const REGION = 'us-east-1'; // single region, ADR-0002

export const ENVIRONMENT_NAMES = ['dev', 'stag', 'prod'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

// The only GitHub repository allowed to deploy (ADR-0004 §4). The OIDC `sub` claim is built from it.
export const GITHUB_REPOSITORY = 'dhnhut/cv-tailor';

// Synth-only mode for CI, which has no real account IDs. The placeholder never
// matches real credentials, so `cdk deploy` refuses to use it.
export const PLACEHOLDER_FLAG = 'CVT_PLACEHOLDER_ACCOUNTS';
export const PLACEHOLDER_ACCOUNT_ID = '000000000000';

const ACCOUNT_ID_PATTERN = /^\d{12}$/;

export const accountIdVar = (name: EnvironmentName): string =>
  `CVT_${name.toUpperCase()}_ACCOUNT_ID`;

// Monthly cost budget per account in USD (S1-09). Budget alerts go to CVT_ALERT_EMAIL.
export const MONTHLY_BUDGET_USD: Record<EnvironmentName, number> = { dev: 5, stag: 5, prod: 10 };

// Alert email address for budget notifications (S1-09). Not committed because the repo is public.
export const ALERT_EMAIL_VAR = 'CVT_ALERT_EMAIL';
export const PLACEHOLDER_ALERT_EMAIL = 'alerts@example.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EnvironmentConfig {
  readonly name: EnvironmentName;
  readonly account: string;
  readonly region: typeof REGION;
  readonly monthlyBudgetUsd: number;
  readonly alertEmail: string;
}

// Check for missing or invalid environment variables.
const checkConfigProblems = (
  env: Record<string, string | undefined>,
  placeholder: boolean,
): void => {
  // if placeholder mode, don't check for missing variables
  if (placeholder) return;

  const problems = [];

  // check account IDs
  for (const name of ENVIRONMENT_NAMES) {
    const variable = accountIdVar(name);
    if (!ACCOUNT_ID_PATTERN.test(env[variable] ?? '')) {
      problems.push(`${variable} (expected 12 digits)`);
    }
  }

  // check alert email
  if (!EMAIL_PATTERN.test(env[ALERT_EMAIL_VAR] ?? '')) {
    problems.push(`${ALERT_EMAIL_VAR} (expected an email address)`);
  }

  if (problems.length > 0) {
    const envMessage = `Set them in the shell or in infra/.env (see infra/.env.example), or set ${PLACEHOLDER_FLAG}=1 to synthesise with placeholders.`;

    throw new Error(`Missing or invalid settings: ${problems.join(', ')}. ` + envMessage);
  }
};

export function loadEnvironments(
  env: Record<string, string | undefined> = process.env,
): EnvironmentConfig[] {
  const placeholder = env[PLACEHOLDER_FLAG] === '1';

  checkConfigProblems(env, placeholder);

  return ENVIRONMENT_NAMES.map((name) => ({
    name,
    account: placeholder ? PLACEHOLDER_ACCOUNT_ID : (env[accountIdVar(name)] as string),
    region: REGION,
    monthlyBudgetUsd: MONTHLY_BUDGET_USD[name],
    alertEmail: placeholder ? PLACEHOLDER_ALERT_EMAIL : (env[ALERT_EMAIL_VAR] as string),
  }));
}

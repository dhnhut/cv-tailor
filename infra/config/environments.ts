// Per-environment settings for the CDK app (S1-06, S1-09).
// Account IDs and the alert email are not committed (public repo, ADR-0004 §2). They come from
// CVT_<ENV>_ACCOUNT_ID and CVT_ALERT_EMAIL, set in the shell or in infra/.env (see infra/.env.example).

export const REGION = 'us-east-1'; // single region, ADR-0002

export const ENVIRONMENT_NAMES = ['dev', 'stag', 'prod'] as const;
export type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

// The only GitHub repository allowed to deploy (ADR-0004 §4). The OIDC `sub` claim is built from it.
// GitHub's immutable subject format names the owner and repository by name and numeric ID, so a renamed
// or re-created repository can't match. The IDs are public:
//   gh api repos/dhnhut/cv-tailor --jq '{owner_id: .owner.id, repo_id: .id}'
export interface GithubRepository {
  readonly owner: string;
  readonly ownerId: number;
  readonly name: string;
  readonly id: number;
}

export const GITHUB_REPOSITORY: GithubRepository = {
  owner: 'dhnhut',
  ownerId: 5567608,
  name: 'cv-tailor',
  id: 1386961484,
};

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

// The web app's host in each environment (ADR-0008). The API and the sign-in pages
// use api.<host> and auth.<host>.
export const HOST: Record<EnvironmentName, string> = {
  dev: 'dev.cv.ikiwii.com',
  stag: 'stag.cv.ikiwii.com',
  prod: 'cv.ikiwii.com',
};

// The Vite dev server (apps/web). Only dev's app client accepts it as a sign-in callback, so the
// web app on a laptop can sign in against dev (ADR-0009 §5).
export const LOCAL_WEB_ORIGIN = 'http://localhost:5173';

// Google sign-in (S2-06, ADR-0009). Each environment has its own Google OAuth client. Its ID is
// public (Google shows it in every sign-in URL), so it's committed. Its secret isn't: it's stored
// by hand in Secrets Manager (google-sign-in runbook). stag and prod get clients with the release
// path (slice R).
export const GOOGLE_CLIENT_ID: Partial<Record<EnvironmentName, string>> = {
  dev: '963342850841-qvv0u3e8bucs75d0amgr7ah16kveic4a.apps.googleusercontent.com',
};

// A child zone delegated from an environment's zone (ADR-0008). Name servers are public
// DNS data, so they are committed. They come from the child zone stack's NameServers
// output after its first deploy (deploy runbook, step 3).
export interface ZoneDelegation {
  readonly zoneName: string;
  readonly nameServers: readonly string[];
}

// An environment's <env>-dns stage (S2-03): its hosted zone for <host>, the child zones it
// delegates, and whether it has a certificate for <host> and *.<host>.
export interface DnsConfig {
  readonly certificate: boolean;
  readonly delegations: readonly ZoneDelegation[];
}

// stag gets its zone, and prod its certificate, with the release path (slice R, ADR-0005).
export const DNS: Partial<Record<EnvironmentName, DnsConfig>> = {
  dev: { certificate: true, delegations: [] },
  prod: {
    certificate: false,
    delegations: [
      {
        // The dev-dns-Zone NameServers output, 2026-10-02.
        zoneName: 'dev.cv.ikiwii.com',
        nameServers: [
          'ns-1749.awsdns-26.co.uk',
          'ns-1117.awsdns-11.org',
          'ns-155.awsdns-19.com',
          'ns-524.awsdns-01.net',
        ],
      },
    ],
  },
};

export interface EnvironmentConfig {
  readonly name: EnvironmentName;
  readonly account: string;
  readonly region: typeof REGION;
  readonly host: string;
  readonly monthlyBudgetUsd: number;
  readonly alertEmail: string;
  readonly dns?: DnsConfig; // absent: the environment has no DNS stage yet
  readonly webOrigins: readonly string[]; // where the web app runs, for sign-in callbacks (S2-05)
  readonly googleClientId?: string; // absent: no Google sign-in yet (S2-06)
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

  return ENVIRONMENT_NAMES.map((name) => {
    const dns = DNS[name];
    const googleClientId = GOOGLE_CLIENT_ID[name];
    return {
      name,
      account: placeholder ? PLACEHOLDER_ACCOUNT_ID : (env[accountIdVar(name)] as string),
      region: REGION,
      host: HOST[name],
      webOrigins: [`https://${HOST[name]}`, ...(name === 'dev' ? [LOCAL_WEB_ORIGIN] : [])],

      monthlyBudgetUsd: MONTHLY_BUDGET_USD[name],
      alertEmail: placeholder ? PLACEHOLDER_ALERT_EMAIL : (env[ALERT_EMAIL_VAR] as string),
      ...(dns ? { dns } : {}),
      ...(googleClientId ? { googleClientId } : {}),
    };
  });
}

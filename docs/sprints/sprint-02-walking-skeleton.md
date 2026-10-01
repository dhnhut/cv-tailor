# Sprint 2: Walking Skeleton and Sign-In

**Sprint goal:** A candidate can sign up and sign in at `dev.cv.ikiwii.com` with email/password or Google, and the API knows who they are. The kill switch and the per-call token cap exist before the first AI call. The managed knowledge base's per-candidate isolation is tested.

**Dates:** 2026-10-01 to 2026-10-07

**Status:** In progress

## Scope

- DNS on the owner's domain: the `cv.ikiwii.com` zone in `prod`, the `dev.cv.ikiwii.com` zone in `dev`, and a certificate for `dev` ([ADR-0008](../adr/0008-domain-and-dns.md))
- The SPA on S3 and CloudFront at `dev.cv.ikiwii.com`, deployed by CI
- Sign-in with Amazon Cognito: email/password, Google, account linking, and the `admin` group (AUTH-01, AUTH-02)
- API Gateway at `api.dev.cv.ikiwii.com` with a Cognito authorizer and a first endpoint, `GET /me`
- The DynamoDB data table and its key-format module ([ADR-0006](../adr/0006-data-store.md))
- The cost guards that must exist before the first AI call in Sprint 3: the kill switch (ADMIN-03) and the per-call token cap (QUOTA-04)
- Two time-boxed spikes: the managed knowledge base ([ADR-0007](../adr/0007-knowledge-base-store.md)) and LinkedIn sign-in

This is slice A of [ADR-0005](../adr/0005-mvp-scope.md), plus the kill switch and token cap from slice B and the two spikes. Only `dev` runs workloads. `prod` gets its DNS zone and nothing else.

---

## Target Picture

```text
ikiwii.com              registrar DNS
└─ cv.ikiwii.com        Route 53 zone, cv-tailor-prod      ← NS records at the registrar
   └─ dev.cv.ikiwii.com Route 53 zone, cv-tailor-dev       ← NS records in cv.ikiwii.com
                        ACM certificate: dev.cv.ikiwii.com, *.dev.cv.ikiwii.com

Browser
├─ https://dev.cv.ikiwii.com          CloudFront → private S3 bucket (SPA + config.json)
├─ https://auth.dev.cv.ikiwii.com     Cognito managed login ──→ Google
│                                       └─ pre sign-up trigger (account linking)
└─ https://api.dev.cv.ikiwii.com/me   API Gateway (Cognito authorizer) → Lambda → DynamoDB
```

| Stage            | Deployed by | Holds after this sprint                                            |
| ---------------- | ----------- | ------------------------------------------------------------------ |
| `<env>-access`   | Laptop      | GitHub OIDC provider and deploy role (Sprint 1)                    |
| `<env>-baseline` | Laptop      | Budget (Sprint 1) and the kill switch parameter (new)              |
| `<env>-dns`      | Laptop      | Hosted zone, certificate, and SSM parameters with their IDs (new)  |
| `<env>`          | CI          | Web hosting, user pool, API, data table (new; hello stack removed) |

---

## Backlog

| ID    | Item                                | Requirement IDs    | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2-01 | Sprint doc                          | —                  | This doc is merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| S2-02 | ADR-0009: sign-in and API access    | AUTH-01, AUTH-02   | `docs/adr/0009-sign-in-and-api-access.md` settles every point in [S2-02 details](#s2-02-details-what-adr-0009-settles), with sources for any Cognito behaviour it relies on. Status is "Accepted", and `AGENTS.md` §7 is updated.                                                                                                                                                                                                                                                                 |
| S2-03 | DNS zones and certificate           | §10                | A `<env>-dns` stage holds the `cv.ikiwii.com` zone in `prod` (NS records at the registrar) and the `dev.cv.ikiwii.com` zone in `dev` (NS delegation record in the `prod` zone). An ACM certificate for `dev.cv.ikiwii.com` and `*.dev.cv.ikiwii.com` is `ISSUED` in `dev`. Zones are retained on stack deletion, and the stacks have termination protection. A test checks the stage. ADR-0008 verification steps 1–3 pass.                                                                       |
| S2-04 | SPA hosting                         | §7                 | `dev.cv.ikiwii.com` serves the SPA from a private S3 bucket through CloudFront (origin access control, HTTPS only, `PriceClass_All` so Australian and New Zealand edge locations are used). A response headers policy sets HSTS and a content security policy. Deep links return the app. The SPA reads its settings from a `config.json` that CDK writes at deploy time. CI builds the SPA and deploys it with the `dev` stage. The hello stack is removed. ADR-0008 verification step 4 passes. |
| S2-05 | Cognito user pool                   | AUTH-01, AUTH-02   | A user pool, configured as ADR-0009 decides: email/password self sign-up, managed login at `auth.dev.cv.ikiwii.com`, an `admin` group, and a public app client using the authorization code flow with PKCE. Callback URLs are on `dev.cv.ikiwii.com` (plus `localhost` in `dev` only). Deletion protection is on, and the pool is retained on stack deletion. A test checks the pool settings. A new user can sign up and sign in through managed login on the real domain.                       |
| S2-06 | Google sign-in                      | AUTH-02            | A Google OAuth client for `dev`. Its secret is stored by hand and referenced by name, never committed. A Cognito Google identity provider maps `email` and `email_verified`, and asks only for the `openid` and `email` scopes. Managed login shows Google. A Google sign-in on `dev.cv.ikiwii.com` works, and the user's `email_verified` is `true`.                                                                                                                                             |
| S2-07 | Account-linking pre sign-up trigger | AUTH-02            | A pre sign-up Lambda implements the linking rules in ADR-0009. Tests cover each case in ADR-0009, including the takeover case: an account whose email is not verified, followed by a Google sign-in with the same email, must not link. The Lambda's IAM policy allows only the Cognito actions it uses, on this pool only. Checked live in `dev`: a linked Google sign-in gets the same `sub` as the password account, and the takeover case gets a different one.                               |
| S2-08 | Data table and key-format module    | §7                 | One table per environment, `cv-tailor-<env>-data`, in the workload stage: on-demand, point-in-time recovery on, TTL on `expiresAt`, retained on stack deletion. One module builds every key in ADR-0006, with tests. ADR-0006 verification step 1 passes.                                                                                                                                                                                                                                         |
| S2-09 | API and `GET /me`                   | AUTH-02, §7        | An API Gateway API of the type ADR-0009 decides, at `api.dev.cv.ikiwii.com`, with a Cognito authorizer, CORS for `dev.cv.ikiwii.com` only, and low stage throttling. `GET /me` returns the caller's `sub`, email, and whether they are an admin, and creates their profile item on the first call. The response schema is in `packages/contracts` and is used by both the API and the web app. The Lambda can read and write only the data table. A request without a valid token gets `401`.     |
| S2-10 | SPA sign-in                         | AUTH-01, AUTH-02   | The SPA signs in through managed login (email/password and Google), handles the callback, keeps tokens as ADR-0009 decides, calls `GET /me`, shows the result, and signs out. A signed-out user who opens a protected page is sent to sign-in. Tests cover each state. Checked live on `dev.cv.ikiwii.com` with both sign-in methods.                                                                                                                                                             |
| S2-11 | AI call guard: kill switch and caps | ADMIN-03, QUOTA-04 | In `services/agents`, one module creates every Bedrock model client, and a test fails if any other module creates one. Before each call it checks the kill switch (see [S2-11 details](#s2-11-details-the-ai-call-guard)) and enforces the per-call caps on output and input tokens. Tests cover: the switch blocks calls, an unreadable or missing switch blocks calls, a call over a cap is refused. The [kill switch runbook](../runbooks/kill-switch.md) is filled in. Checked live in `dev`. |
| S2-12 | Managed knowledge base spike        | KB-05              | Time-boxed to one day. ADR-0007 verification steps 1–3 are run in `dev`, and the results are recorded in ADR-0007 and the sprint review. The spike answers: does the CDK L1 construct support `ManagedKnowledgeBaseConfiguration`, and does the service accept synthetic identities (`<sub>@users.cv-tailor.invalid`)? If either answer is no, ADR-0007's fallback is proposed before Sprint 3. Spike resources are deleted afterwards.                                                           |
| S2-13 | LinkedIn spike                      | AUTH-02            | Time-boxed to half a day. LinkedIn is tried as a Cognito OIDC provider in `dev`. Pass: sign-in works and returns a verified email, with no proxy or custom code. Fail: LinkedIn moves to a later release (ADR-0005). Either way, the result and the reason are recorded in the sprint review.                                                                                                                                                                                                     |
| S2-14 | Close the sprint                    | DoD                | The sprint review is filled in, and every backlog ID has a "Done" or "Not done" entry.                                                                                                                                                                                                                                                                                                                                                                                                            |

### S2-02 details: what ADR-0009 settles

1. **One `sub` per person, for life.** Data is keyed by the Cognito `sub` (ADR-0006), and so are knowledge base ACLs (ADR-0007). Cognito can only link an external identity that does not exist yet into an existing native user, so the order of sign-in methods matters. The ADR shows that the `sub` never changes, whichever method a person uses first.
2. **Account-linking rules,** as a table of cases: password account first, Google first, no account yet, and an account whose email is not verified (the takeover case). For each case: link, create, or refuse, and what the user sees.
3. **Email verification at sign-up in the MVP.** AUTH-03 (optional verification with a higher quota for verified accounts) arrives with tiers in a later release. Until then, every candidate gets the same quota, so the ADR decides whether a password sign-up must confirm its email first.
4. **User pool settings:** the Cognito feature plan and its cost, sign-in attributes, password policy, MFA, token lifetimes, and the email sender (Cognito's default sender, or SES, and when SES is needed).
5. **SPA sign-in:** the authorization code flow with PKCE, the client library, and where tokens are kept in the browser.
6. **API Gateway type:** REST API or HTTP API, and which token the authorizer accepts. `AGENTS.md` §8 plans API Gateway usage plans, which only REST APIs have.
7. **The `admin` group:** how members are added, and how the API sees membership.

### S2-03 details: DNS order

Each step waits for the one before it:

```text
1. prod-dns/Zone          cv.ikiwii.com zone in cv-tailor-prod     → I add its NS records at the registrar
2. dev-dns/Zone           dev.cv.ikiwii.com zone in cv-tailor-dev  → its NS values go into infra/config/environments.ts
3. prod-dns/Zone again    adds the NS delegation record for dev.cv.ikiwii.com
4. dev-dns/Certificate    certificate for dev.cv.ikiwii.com and *.dev.cv.ikiwii.com, validated in the dev zone
```

- Step 4 starts only when `dig NS dev.cv.ikiwii.com +short` returns the `dev` zone's name servers, because ACM checks the validation record through public DNS.
- The certificate is in the `<env>-dns` stage, not the workload stage. CI never waits on certificate validation, and a workload change can't replace the certificate.
- The `<env>-dns` stage writes the zone ID and the certificate ARN to SSM parameters. The workload stage reads them at deploy time (`ssm.StringParameter.valueForStringParameter`), so synthesis needs no lookups and no resource IDs are committed.
- Only `dev` and `prod` get zones in this sprint. `stag` gets its zone with the release path (slice R).

### S2-04 details: one build for every environment

- The SPA reads its settings (user pool ID, client ID, sign-in and API URLs) from `/config.json`. CDK writes that file at deploy time with `Source.jsonData`, which resolves CloudFormation values. The same build then serves every environment, so the build tested in `stag` can be the build released to `prod` (slice R).
- CDK's `BucketDeployment` uploads the files, so the deploy role keeps no direct permissions on AWS resources (S1-07).
- `index.html` and `config.json` are not cached. Hashed assets are cached for a long time.

### S2-11 details: the AI call guard

- **Kill switch:** an SSM parameter, `/cv-tailor/ai-calls`, in the `<env>-baseline` stage, deployed from a laptop. CI never deploys that stage, so a CI deploy can't reset the switch. CloudFormation sets the value only when it creates the parameter, so later changes made with `aws ssm put-parameter` stay in place. The initial value comes from the environment config: `enabled` in `dev`, and `disabled` in `stag` and `prod` until their first release.
- **Fail closed:** only the value `enabled` allows calls. Any other value, a missing parameter, or a read error blocks them. A good value is cached for 30 seconds, so a change takes effect within 30 seconds. A read error is not cached.
- **What it covers:** every paid AI call (model calls now, and knowledge base Retrieve calls when Sprint 3 adds them), because ADMIN-03 turns off all AI calls.
- **Caps (QUOTA-04):** every model call sets `maxTokens` at or below the output cap. A call that asks for more is refused, not reduced, because it is a bug. The input is capped too. The item chooses how to count input tokens (Bedrock token counting where the model supports it, or a character limit) and records why.
- **How it is switched:** with the AWS CLI, as the runbook describes. An admin screen comes later (ADMIN-01). The TypeScript check in the API comes with the first endpoint that starts AI work (Sprint 3).

---

## Execution Guide (step by step)

See the owner legend in [README.md](README.md#owner-legend). Every step follows the [git flow](README.md#git-flow).

| #   | Step                        | Item  | Owner                          | How                                                                                                                                                                                                                                                                                                                 | Verify                                                                                                                                                                                              |
| --- | --------------------------- | ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Save the sprint doc         | S2-01 | Claude                         | Write this file.                                                                                                                                                                                                                                                                                                    | I read and approve it.                                                                                                                                                                              |
| 2   | Record the sign-in decision | S2-02 | Claude drafts, **Me** decides  | Claude drafts `docs/adr/0009-sign-in-and-api-access.md` with options for each point in the S2-02 details, checked against the current Cognito and API Gateway documentation.                                                                                                                                        | ADR status is "Accepted".                                                                                                                                                                           |
| 3   | DNS zones and certificate   | S2-03 | Me + Claude                    | Claude gives the `<env>-dns` stage and its test. I deploy in the order in the S2-03 details, from my laptop with `--profile cvt-prod` and `--profile cvt-dev`, and add the NS records at the registrar.                                                                                                             | `dig NS cv.ikiwii.com +short` and `dig NS dev.cv.ikiwii.com +short` return the Route 53 name servers. `aws acm list-certificates --profile cvt-dev` shows the certificate as `ISSUED`.              |
| 4   | SPA hosting                 | S2-04 | Me + Claude                    | Claude gives the hosting construct, the `config.json` loader in the SPA, and the `deploy.yml` change that builds the SPA before `cdk deploy`.                                                                                                                                                                       | After the merge, the `main` run is green, including `deploy-dev`. `curl -sI https://dev.cv.ikiwii.com/some/deep/link` returns `200` with `strict-transport-security` and `content-security-policy`. |
| 5   | User pool                   | S2-05 | Me + Claude                    | Claude gives the user pool construct and its test, as ADR-0009 decides. It runs after step 4, because the Cognito custom domain needs `dev.cv.ikiwii.com` to resolve (ADR-0008). I add myself to `admin` with the CLI command the runbook gives.                                                                    | In a private window, I sign up and sign in through `https://auth.dev.cv.ikiwii.com`. `aws cognito-idp admin-list-groups-for-user --profile cvt-dev …` lists `admin` for my user.                    |
| 6   | Google sign-in              | S2-06 | **Me**, then Me + Claude       | I create the Google OAuth client (redirect URI `https://auth.dev.cv.ikiwii.com/oauth2/idpresponse`) and store its secret in `dev` by hand. Claude gives the identity provider construct. Before using Secrets Manager, check whether CloudFormation can pass an SSM SecureString to this resource (`AGENTS.md` §7). | Google appears on the managed login page, a Google sign-in works, and the user's `email_verified` is `true`.                                                                                        |
| 7   | Account linking             | S2-07 | Me + Claude                    | Claude gives the trigger, its tests (one per ADR-0009 case), and the IAM policy. I run the live checks with test users.                                                                                                                                                                                             | Tests pass. Live: the linked Google sign-in shows the password account's `sub`, and the takeover case shows a different `sub`.                                                                      |
| 8   | Data table                  | S2-08 | Me + Claude                    | Claude gives the table construct, the key-format module, and their tests.                                                                                                                                                                                                                                           | `pnpm --filter infra test` passes, and the synthesised template has one `AWS::DynamoDB::Table` per environment with the ADR-0006 settings.                                                          |
| 9   | API and `GET /me`           | S2-09 | Me + Claude                    | Claude gives the API construct, the handler, its contract, and tests.                                                                                                                                                                                                                                               | `curl -s -o /dev/null -w '%{http_code}' https://api.dev.cv.ikiwii.com/me` prints `401`. With a token, the response matches the contract, and the profile item exists in the table.                  |
| 10  | SPA sign-in                 | S2-10 | Me + Claude                    | Claude gives the sign-in flow, the protected route, the `/me` page, and tests.                                                                                                                                                                                                                                      | On `dev.cv.ikiwii.com`, I sign in with each method, see my profile, sign out, and am sent to sign-in when I open the profile page again.                                                            |
| 11  | AI call guard               | S2-11 | Me + Claude                    | Claude gives the guard module, its tests, the SSM parameter in the baseline stage, and the runbook. I deploy `dev-baseline/*` from my laptop.                                                                                                                                                                       | With the parameter `enabled`, a tiny model call through the guard succeeds. Within 30 seconds of setting it to `disabled`, the same call is refused before any request reaches Bedrock.             |
| 12  | Knowledge base spike        | S2-12 | Me + Claude                    | Claude gives the spike stack and a Retrieve script. I deploy it to `dev` from my laptop, run the checks, and delete it.                                                                                                                                                                                             | ADR-0007 verification steps 1–3 have recorded results.                                                                                                                                              |
| 13  | LinkedIn spike              | S2-13 | Me + Claude                    | I create a LinkedIn app. Claude gives the OIDC provider settings to try. Stop at half a day.                                                                                                                                                                                                                        | The result is recorded, with the reason.                                                                                                                                                            |
| 14  | Close the sprint            | DoD   | Claude drafts, **Me** approves | Fill in the sprint review, and list any backlog ID without a "Done" or "Not done" entry.                                                                                                                                                                                                                            | The sprint review below is complete.                                                                                                                                                                |

Steps 8, 11, and 12 need only the repo and the `dev` account, so they can run while step 3 waits on the registrar and DNS propagation. Step 12 runs early, because its result can change ADR-0007 before Sprint 3 needs it.

---

## Out of Scope (current sprint)

- Workloads in `stag` and `prod`, and the `stag` DNS zone (`prod` gets only its zone)
- Quota counters and quota checks, which come with the rest of slice B in Sprint 6. ADR-0006 verification steps 2–4 move with the features they test.
- Tiers, optional email verification (AUTH-03), CAPTCHA, and usage plans (a later release, slice I)
- Any AI feature, and AgentCore deploys (Sprint 3)
- Knowledge base uploads (Sprint 3). The spike only tests isolation.
- An admin screen for the kill switch
- AWS WAF

## Risks

| Risk                                                                                                                                         | Mitigation                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The registrar can't hold NS records for `cv.ikiwii.com`, or delegation is slow to propagate.                                                 | Step 3 runs first, and steps 8, 11, and 12 run meanwhile. If the registrar can't delegate a subdomain, ADR-0008 is revisited before step 4.                                   |
| A person's `sub` changes (for example, Google first and a password later), so their data and knowledge base documents are cut off from them. | ADR-0009 shows the `sub` never changes for any order of sign-in methods. S2-07 tests every case.                                                                              |
| Account linking lets someone take over another person's account.                                                                             | Link only when the email is verified. S2-07 tests the takeover case and checks it live.                                                                                       |
| Tokens in the browser are exposed to injected scripts (XSS).                                                                                 | ADR-0009 decides where tokens are kept. S2-04 sets a content security policy.                                                                                                 |
| The managed knowledge base rejects synthetic identities, or CDK doesn't support it.                                                          | S2-12 runs early in the sprint. ADR-0007 already names the fallback for each case.                                                                                            |
| Cognito's default email sender has a low daily limit.                                                                                        | Enough for `dev`. ADR-0009 records when SES is needed, which must be before the first `prod` release.                                                                         |
| New fixed costs.                                                                                                                             | Two hosted zones (USD 0.50 per month each, one in `dev` and one in `prod`) and one secret in `dev` (USD 0.40 per month, if Secrets Manager is used). The rest is pay per use. |
| The sprint runs over: 14 items, most of them on services new to the project.                                                                 | S2-13 moves first. S2-12 runs early, so it shouldn't need to move; if it does, it opens Sprint 3, because the knowledge base slice depends on it.                             |

## Definition of Done (Sprint 2)

- All S2 items are merged to `main` through PRs with green CI.
- After every merge, `gh run list --branch main --limit 1` shows the `main` run green, including `deploy-dev` (Sprint 1 lesson).
- An item that connects two systems (DNS delegation, Google sign-in, the API authorizer) closes only after a real run on `dev.cv.ikiwii.com` succeeds. An item deployed from a laptop closes only after its live verify steps pass (Sprint 1 lesson).
- Each item's PR adds its "Done" entry to the sprint review.
- ADR-0009 is accepted, and `AGENTS.md` is updated.
- The sprint review is filled in.

## Verification

1. `dig NS cv.ikiwii.com +short` and `dig NS dev.cv.ikiwii.com +short` return the Route 53 name servers of the `prod` and `dev` zones. The `dev` certificate is `ISSUED`.
2. `curl -sI https://dev.cv.ikiwii.com/some/deep/link` returns `200`, with `strict-transport-security` and `content-security-policy` headers.
3. In a private window, a new user signs up with email/password on `dev.cv.ikiwii.com`, signs in, and sees their profile from `GET /me`.
4. A Google sign-in with the same verified email shows the same `sub`.
5. The takeover case in ADR-0009 doesn't link: the Google sign-in shows a different `sub`.
6. `curl -s -o /dev/null -w '%{http_code}' https://api.dev.cv.ikiwii.com/me` prints `401`.
7. A user in the `admin` group sees the admin role in `GET /me`.
8. With `/cv-tailor/ai-calls` set to `disabled` in `dev`, the guard refuses a call within 30 seconds. With `enabled`, a tiny call succeeds.
9. The synthesised template has one DynamoDB table per environment, with on-demand billing, point-in-time recovery, and TTL on `expiresAt` (ADR-0006 verification step 1).
10. ADR-0007 has recorded results for its verification steps 1–3.

---

## Sprint Review

- **Done:**
- **Not done / carried over:**
- **What changed and why:**
- **Lessons learned:**
- **Next sprint backlog:**

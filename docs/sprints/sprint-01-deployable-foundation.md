# Sprint 1: Deployable Foundation

**Sprint goal:** A merge to `main` deploys the hello stack to a real `dev` account through GitHub OIDC. Every environment has its own account, SSO access, a budget alarm, and baseline guardrails. The MVP scope is decided.

**Dates:** 2026-09-29 to 2026-10-05

**Status:** In progress

## Scope

- AWS Organization with separate `dev`, `stag`, and `prod` accounts, plus a shared `log-archive` account
- Human access through IAM Identity Center (SSO), with no long-lived access keys
- Baseline guardrails: service control policies (SCPs) and an organization CloudTrail trail that delivers to the log archive
- CDK stages per environment, CDK bootstrap, and a GitHub OIDC deploy role in each account
- Automatic deploy of `dev` on every merge to `main`
- AWS Budgets alarms for each environment (`AGENTS.md` §8)
- Coverage gates at the 80% target (`AGENTS.md` §9)
- First operations runbooks
- The MVP scope decision, which feeds the Sprint 2 backlog

The region stays a single region, `us-east-1` ([ADR-0002](../adr/0002-aws-region.md)). No feature code in this sprint.

---

## Target Account Structure

```text
Management account (billing, Organizations, IAM Identity Center, org trail definition; no workloads)
└── Root                         ← baseline SCP (applies to every member account)
    ├── Security (OU)            ← log-protection SCP
    │   └── log-archive          (org CloudTrail S3 bucket; shared by all projects)
    └── Workloads (OU)
        ├── NonProd (OU)
        │   ├── cv-tailor-dev
        │   └── cv-tailor-stag
        └── Prod (OU)            ← stricter prod SCPs later
            └── cv-tailor-prod
```

**Why this structure:**

- **OUs group accounts by policy, not by environment or project.** `dev` and `stag` share the same guardrails, so they share `NonProd`. `Prod` exists so stricter SCPs can apply to `prod` later without touching `dev` and `stag`.
- **One account per environment** gives a hard boundary for permissions, quotas, and cost. A mistake in `dev` can't touch `prod`, and each account's bill is its environment's cost.
- **The account is the project boundary.** The Organization can host other projects later: their accounts (`<project>-<env>`) go into the same `NonProd` and `Prod` OUs and inherit the same guardrails.
- **The management account holds no workloads.** SCPs don't apply to the management account, so anything deployed there would sit outside the guardrails.
- **A shared log archive account** keeps the audit logs out of the management account, the most powerful account in the Organization. One trail serves every project.
- **IAM Identity Center** gives short-lived credentials (`aws sso login`) for humans. **GitHub OIDC** gives short-lived credentials for CI. No AWS access keys are stored anywhere.
- **Not Control Tower.** It adds a landing zone, extra accounts, and AWS Config costs that aren't needed at this size. ADR-0004 records this.

---

## Backlog

| ID    | Item                                   | Requirement IDs | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1-01 | Sprint doc                             | —               | This doc is merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| S1-02 | ADR-0004: account structure and access | §10             | `docs/adr/0004-accounts-and-access.md` records the Organization layout (OUs grouped by policy, three workload accounts, a shared `log-archive` account in a `Security` OU, a management account for billing and identity only, account naming, and how future projects fit in), IAM Identity Center, GitHub OIDC (no AWS keys in GitHub), the CDK bootstrap trust model, and the SCP design. Control Tower is listed as a rejected option. Status is "Accepted", and `AGENTS.md` §10 is updated. |
| S1-03 | AWS Organization + accounts            | §10             | The Organization exists, with `dev` and `stag` in `Workloads/NonProd`, `prod` in `Workloads/Prod`, and `log-archive` in `Security`. The management root user has MFA. Centralized root access management is on, so member accounts have no root credentials. Account emails are unique addresses that reach one mailbox.                                                                                                                                                                         |
| S1-04 | IAM Identity Center                    | §8              | One SSO user with MFA. Permission sets `AdministratorAccess` and `ReadOnlyAccess`, with a short session duration. Local profiles `cvt-dev`, `cvt-stag`, and `cvt-prod` work with `aws sso login`. After SSO works, the IAM user in the management account is deleted, or kept as a console-only fallback with MFA and no access keys.                                                                                                                                                            |
| S1-05 | Baseline guardrails                    | SAFE-04, §8     | A baseline SCP on Root (it never applies to the management account): deny leaving the Organization; deny every region except `us-east-1` (global services exempt, and Bedrock inference exempt in the regions that `us.` inference profiles route to); deny stopping or deleting CloudTrail. A log-protection SCP on `Security`. An organization CloudTrail trail records management events into an S3 bucket in `log-archive`. The SCP JSON is committed under `infra/org/scps/`.               |
| S1-06 | CDK stages per environment             | §10             | `infra/bin/infra.ts` builds one `Stage` per environment from a typed config (`infra/config/environments.ts`, with account ID and region). The hello stack is in each stage. A test checks that every stage synthesises and pins `us-east-1` (ADR-0002, verification step 2).                                                                                                                                                                                                                     |
| S1-07 | CDK bootstrap + GitHub OIDC role       | §7, §10         | All three accounts are bootstrapped in `us-east-1`. An `OidcStack` in each account creates the GitHub OIDC provider and a deploy role. The role trusts only `repo:dhnhut/cv-tailor:environment:<env>` and may only assume the `cdk-*` roles that bootstrap creates. A test checks the trust policy.                                                                                                                                                                                              |
| S1-08 | Deploy workflow (dev)                  | §7, §10         | `.github/workflows/deploy.yml` runs on pushes to `main` after the `check` job passes. It uses the GitHub Environment `dev` and `id-token: write`, pins actions to commit SHAs, and runs `cdk deploy` for the dev stage. The hello stack's output is visible in the dev account.                                                                                                                                                                                                                  |
| S1-09 | Budgets alarms per environment         | §8              | One `AWS::Budgets::Budget` per environment, defined in CDK. Email alerts at 50%, 80%, and 100% of actual spend, and at 100% of forecast spend. The amounts for `dev`, `stag`, and `prod` are chosen by me. The `dev` budget is deployed.                                                                                                                                                                                                                                                         |
| S1-10 | Re-run the service check in dev        | §5.4            | Bedrock model access is requested in the dev account. `scripts/aws-service-check.sh --profile cvt-dev` is run, and `docs/cloud/service-availability.md` gets a per-account results section with any differences (ADR-0002, verification step 1).                                                                                                                                                                                                                                                 |
| S1-11 | Coverage gates at 80%                  | §9              | Each TypeScript package sets Vitest `coverage.thresholds` (v8 provider) to 80%. `services/agents` runs `pytest --cov --cov-fail-under=80`. Both run inside `pnpm run check`, so CI fails below 80%. Generated contracts are excluded, and each exclusion is documented.                                                                                                                                                                                                                          |
| S1-12 | Runbooks                               | ADMIN-03 later  | `docs/runbooks/` has: account access (SSO login), deploy and rollback, and budget alarm response. The kill switch runbook stays a placeholder until the feature exists.                                                                                                                                                                                                                                                                                                                          |
| S1-13 | MVP scope decision                     | all             | Claude drafts options: feature slices mapped to requirement IDs, their order, and the open decisions each depends on. I decide. The decision is recorded in `AGENTS.md`, and the Sprint 2 backlog is drafted.                                                                                                                                                                                                                                                                                    |
| S1-14 | Close the sprint                       | DoD             | The sprint review is filled in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### S1-05 details: SCP design

- **Region deny** uses the `aws:RequestedRegion` condition with a `NotAction` list for global services (IAM, Organizations, STS, CloudFront, Budgets, Route 53, Support, Cost Explorer, and similar). The exact list comes from the AWS example SCP and is recorded in ADR-0004.
- **Bedrock cross-region inference:** a `us.` inference profile is called in `us-east-1` but can run the request in other US regions. The region deny must not block those calls. The allowed regions are read from `aws bedrock get-inference-profile` when the SCP is written, not assumed.
- **Test before attaching to `prod`:** attach to `NonProd` first, verify, then attach to Root.
- **Fewest policies:** statements are merged into one baseline policy, because AWS allows at most 5 SCPs per target, including `FullAWSAccess`.

### S1-07 details: OIDC trust model

```text
GitHub Actions job (environment: dev)
  └─ OIDC token (sub = repo:dhnhut/cv-tailor:environment:dev)
      └─ sts:AssumeRoleWithWebIdentity → GithubDeployRole (dev account)
          └─ sts:AssumeRole → cdk-*-deploy-role, cdk-*-file-publishing-role, cdk-*-lookup-role
              └─ CloudFormation deploys the stack
```

- The deploy role has **no direct permissions** on AWS resources. CDK's bootstrap roles do the work, and the CloudFormation execution role is the only role that changes resources.
- Trusting `environment:<env>` instead of `ref:refs/heads/main` means GitHub Environment protection rules (branch filters, and later manual approval for `prod`) also protect the AWS role.
- `OidcStack` is deployed once per account from a laptop with SSO credentials, because GitHub can't deploy until the role exists.

---

## Execution Guide (step by step)

See the owner legend in [README.md](README.md#owner-legend). Every step follows the [git flow](README.md#git-flow).

| #   | Step                        | Item  | Owner                          | How                                                                                                                                                                                                           | Verify                                                                                                                                                                                          |
| --- | --------------------------- | ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Save the sprint doc         | S1-01 | Claude                         | Write this file.                                                                                                                                                                                              | I read and approve it.                                                                                                                                                                          |
| 2   | Record the account decision | S1-02 | Claude drafts, **Me** decides  | Claude drafts `docs/adr/0004-accounts-and-access.md`. To settle: the OU layout for more than one project, the log archive account, no workloads in the management account, and the SCP exemptions.            | ADR status is "Accepted".                                                                                                                                                                       |
| 3   | Create the Org and accounts | S1-03 | **Me**                         | AWS Console → Organizations: create the Organization, the OUs, and the four member accounts. Turn on MFA for the management root user, then turn on centralized root access management.                       | `aws organizations list-accounts --profile <mgmt>` lists `dev`, `stag`, `prod`, and `log-archive` as `ACTIVE`.                                                                                  |
| 4   | Set up IAM Identity Center  | S1-04 | **Me**                         | Enable Identity Center in `us-east-1`. Create my user with MFA, the two permission sets, and the account assignments. Claude gives the `~/.aws/config` SSO profile block.                                     | `aws sso login --profile cvt-dev`, then `aws sts get-caller-identity --profile cvt-dev` shows the dev account.                                                                                  |
| 5   | Attach guardrails           | S1-05 | Me + Claude                    | Claude gives the SCP JSON and the org trail and log bucket settings. I create the bucket in `log-archive` and the trail in the management account, and attach the baseline SCP to `NonProd` first, then Root. | `aws s3 ls --region ap-southeast-2 --profile cvt-dev` is denied. A Bedrock `converse` call through a `us.` inference profile works. The trail's bucket in `log-archive` receives recent events. |
| 6   | CDK stages per environment  | S1-06 | Me + Claude                    | Add `infra/config/environments.ts`, a `Stage` per environment in `infra/bin/infra.ts`, and a stage test.                                                                                                      | `pnpm --filter infra exec cdk synth` lists 3 stages. `pnpm --filter infra test` passes.                                                                                                         |
| 7   | Bootstrap and OIDC role     | S1-07 | Me + Claude                    | For each environment: `pnpm --filter infra exec cdk bootstrap aws://<account>/us-east-1 --profile cvt-<env>`. Then deploy `OidcStack` once per account with the same profile.                                 | `aws iam get-role --role-name <deploy-role> --profile cvt-dev` shows the exact `sub` condition. The trust policy test passes.                                                                   |
| 8   | Deploy workflow             | S1-08 | Me + Claude                    | I create the GitHub Environment `dev` (limited to `main`) and store the role ARN as an environment variable. Claude gives `deploy.yml` with `aws-actions/configure-aws-credentials` pinned to a commit SHA.   | After a merge, the deploy workflow is green, and `aws cloudformation describe-stacks --profile cvt-dev` shows the hello stack and its output.                                                   |
| 9   | Budgets                     | S1-09 | **Me** decides, Me + Claude    | I choose the monthly amount for each environment. Claude gives the budget construct, with the amount and alert email in the environment config.                                                               | The budget shows in the Billing console of the dev account. The subscription email is confirmed.                                                                                                |
| 10  | Service check in dev        | S1-10 | **Me** runs, Claude reports    | Request Bedrock model access in the dev account. Run `bash scripts/aws-service-check.sh --profile cvt-dev`. Claude adds the results to the report.                                                            | The report has a per-account section, and every difference from the Sprint 0 results is explained.                                                                                              |
| 11  | Coverage gates              | S1-11 | Me + Claude                    | Add `@vitest/coverage-v8` and thresholds to each TypeScript package, and `pytest-cov` to `services/agents`.                                                                                                   | `pnpm run check` passes. Temporarily deleting a test makes it fail on the threshold.                                                                                                            |
| 12  | Runbooks                    | S1-12 | Claude drafts, **Me** reviews  | Write the account access, deploy and rollback, and budget alarm runbooks from what was done in steps 3–9.                                                                                                     | I can follow each runbook from a fresh shell without extra steps.                                                                                                                               |
| 13  | Decide the MVP scope        | S1-13 | Claude drafts, **Me** decides  | Claude drafts the options with requirement IDs, order, and dependencies. I decide, and `AGENTS.md` is updated.                                                                                                | `AGENTS.md` records the MVP scope, and the Sprint 2 backlog draft is in the review below.                                                                                                       |
| 14  | Close the sprint            | DoD   | Claude drafts, **Me** approves | Fill in the sprint review.                                                                                                                                                                                    | The sprint review below is complete.                                                                                                                                                            |

Steps 6 and 11 only touch the repo, so they can run while steps 3–5 (console work) are in progress.

---

## Out of Scope (current sprint)

- Deploys to `stag` and `prod` (they are bootstrapped only)
- A promotion pipeline and manual approvals
- Any feature code (auth, knowledge base, agents)
- Custom domain and DNS
- AWS Control Tower
- Multi-region

## Risks

| Risk                                                                                                       | Mitigation                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The region-deny SCP blocks Bedrock cross-region inference, because `us.` profiles route across US regions. | Exempt Bedrock inference in the regions the profiles route to, and test with a real call in step 5.                         |
| An OIDC trust that is too broad lets any branch or fork deploy.                                            | Trust only `environment:<env>`, limit the environment to `main`, and test the trust policy in `OidcStack`.                  |
| Account creation, SSO setup, or email verification takes longer than planned.                              | Run the repo-only steps (6, 11) in parallel.                                                                                |
| Bedrock model access approval is delayed.                                                                  | S1-10 only records the result. Nothing in this sprint depends on model access.                                              |
| The coverage gate fails on skeleton code with little logic.                                                | Exclude generated contracts and config files, and document each exclusion.                                                  |
| The sprint runs over 1 week (14 items).                                                                    | S1-12 (runbooks) is the first item to move to Sprint 2. S1-13 moves next, but it must be done before Sprint 2 feature work. |

## Definition of Done (Sprint 1)

- All S1 items are merged to `main` through PRs with green CI.
- ADR-0004 is accepted.
- A push to `main` deploys the `dev` stage.
- `AGENTS.md` records the account structure and the MVP scope.
- The sprint review is filled in.

## Verification

1. From a fresh shell, `aws sso login --profile cvt-dev` works, and `aws sts get-caller-identity --profile cvt-dev` shows the dev account.
2. `aws s3 ls --region ap-southeast-2 --profile cvt-dev` is denied by the SCP.
3. `pnpm --filter infra exec cdk synth` lists the `dev`, `stag`, and `prod` stages, all in `us-east-1`.
4. A merged PR triggers the deploy workflow, which goes green. The hello stack's output is in the dev account.
5. The dev budget is visible in the Billing console, and its alert email is confirmed.
6. Deleting a test makes `pnpm run check` fail on the coverage threshold, and CI turns red.
7. The service availability report has a section with results from the dev account.

---

## Sprint Review

- **Done:**
  - S1-03: the Organization has `cv-tailor-dev` and `cv-tailor-stag` in `Workloads/NonProd`, `cv-tailor-prod` in `Workloads/Prod`, and `log-archive` in `Security`, all `ACTIVE`. The management root user has MFA. Centralized root access management (root credentials management and root sessions) is on. Each of the five accounts has a unique email address.
  - S1-04: IAM Identity Center is enabled in `us-east-1` with one user in an `Administrators` group. The group has `AdministratorAccess` (1 hour) and `ReadOnlyAccess` (4 hours) in all five accounts. The profiles `org-mgmt`, `org-log-archive`, `cvt-dev`, `cvt-stag`, `cvt-prod`, and `cvt-prod-ro` work with `aws sso login`. The management account IAM user and all old access keys are deleted, and no account has IAM users.
- **Not done / carried over:**
- **What changed and why:**
  - S1-04: MFA is context-aware instead of asked at every sign-in, because there is one owner. ADR-0004 §3 records this and switches to always-on when a second person joins.
  - S1-04: the IAM user was deleted, not kept as a console fallback. Break-glass access is the management root user (MFA) and `sts:AssumeRoot`, so ADR-0004 needs no exception.
  - S1-04: access is assigned to a group, not to the user, so adding or removing a person is one membership change.
- **Lessons learned:**
  - IAM Identity Center groups and permission sets can have the same name. A stray group named `ReadOnlyAccess` was created during assignment and given both permission sets. Checking assignments with `aws sso-admin list-account-assignments` found it.
- **Next sprint backlog:**

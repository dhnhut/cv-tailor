# ADR-0004: AWS Account Structure and Access

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-09-29    |
| Deciders    | Project owner |
| Sprint item | S1-02         |

## Context

CV Tailor runs in three environments: `dev`, `stag`, and `prod` (`AGENTS.md` §10). All of them are in a single region, `us-east-1` ([ADR-0002](0002-aws-region.md)). Before any infrastructure is deployed, the project needs to decide:

- how AWS accounts are organised,
- how people sign in,
- how CI deploys without stored keys,
- which guardrails apply to every account.

The same AWS Organization may host **other projects** later. That makes the management account, human sign-in, and audit logs shared infrastructure, not CV Tailor infrastructure.

### Decision drivers

1. **Blast-radius isolation.** A mistake or a leaked credential in `dev` must not reach `prod`.
2. **Guardrails defined once.** Rules that apply everywhere are written and attached once.
3. **No long-lived credentials.** No IAM users with access keys, for people or for CI.
4. **Low cost and low operational load** for a single owner.
5. **Room for more projects** without restructuring the Organization.

## Options Considered

### Option A: One account, with environments separated by tags or name prefixes

- **Pros:** the simplest setup; one bill; no Organization to manage.
- **Cons:** no hard boundary. IAM policies, service quotas, and costs are shared. An over-broad `dev` role can delete `prod` resources.

Rejected, because it fails driver 1.

### Option B: Organization with one OU per environment (`Dev`, `Stag`, `Prod`)

- **Pros:** the tree mirrors the environments.
- **Cons:** `dev` and `stag` need the same guardrails, so the same SCPs are attached twice and kept in sync by hand. An OU that differs from another only in name adds maintenance and no control.

Rejected, because it fails driver 2.

### Option C: Project-first OUs (`Workloads/CvTailor/{NonProd, Prod}`)

- **Pros:** project-specific SCPs (for example this project's region lock) stay with the project.
- **Cons:** the prod and non-prod policies are repeated for every project, and the tree is one level deeper.

Rejected, because it fails driver 2 as soon as a second project exists.

### Option D: A separate Organization for each project

- **Pros:** complete isolation and separate bills.
- **Cons:** IAM Identity Center, the log archive, and the guardrails are repeated for each project. Each Organization adds a management account and its root user to secure.

Rejected, because it fails drivers 2 and 4.

### Option E: AWS Control Tower

- **Pros:** a managed landing zone, with account vending, preventive and detective controls, and a log archive and audit account set up automatically.
- **Cons:** it creates and manages extra accounts and resources, and it turns on AWS Config, which costs money in every governed account and region. For three workload accounts, one person, and one region, it adds more than it saves.

Rejected, because it fails driver 4 at the current size. The layout below uses the same OU names Control Tower expects (`Security`, `Workloads`), so enrolling the Organization later stays possible.

### Option F: Environment-first, shared Organization (chosen)

- **Pros:** OUs follow policy boundaries. Shared guardrails are attached once. Each project and environment is still its own account. New projects fit without changing the tree.
- **Cons:** set up by hand (console and CLI) instead of by a managed service. Account naming has to show which project owns an account.

## Decision

### 1. Organization layout

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

Rules:

- **OUs group accounts by policy.** A new OU is created only when a group of accounts needs different policies.
- **The account is the boundary for both project and environment.** Every environment of every project gets its own account. A future project adds `<project>-dev` to `NonProd` and `<project>-prod` to `Prod`.
- **The management account runs no workloads.** SCPs never apply to the management account, so anything deployed there would sit outside the guardrails.
- **`dev` and `stag` share `NonProd`** because they share the same policies. The account names make the environment clear. Moving an account between OUs is one API call and doesn't touch its resources.
- `Sandbox` and `Suspended` OUs are not created yet. They are added when needed.

### 2. Accounts and root users

| Account          | OU                  | Purpose                                                                    |
| ---------------- | ------------------- | -------------------------------------------------------------------------- |
| Management       | Root                | Billing, Organizations, IAM Identity Center, organization trail definition |
| `log-archive`    | `Security`          | S3 bucket for the organization CloudTrail trail. Nothing else runs here.   |
| `cv-tailor-dev`  | `Workloads/NonProd` | CV Tailor development; deployed on every merge to `main`                   |
| `cv-tailor-stag` | `Workloads/NonProd` | CV Tailor staging                                                          |
| `cv-tailor-prod` | `Workloads/Prod`    | CV Tailor production                                                       |

- **Naming:** `<project>-<env>` for workload accounts. Shared accounts get a plain name (`log-archive`).
- **Root email addresses:** each account has its own address, and all of them deliver to one mailbox (plus-aliases or addresses on an owned domain). The real addresses are not recorded in this repository.
- **Account IDs:** not recorded in this repository either, because it is public. The CDK app reads them from `CVT_<ENV>_ACCOUNT_ID` environment variables, set in a local, gitignored `infra/.env` or by CI.
- **Management root user:** MFA on, used only for break-glass tasks that need root.
- **Member root users:** **centralized root access management** is turned on. Member accounts have no root password, access keys, or MFA devices to lose. A task that needs root in a member account (for example deleting a bucket policy that locks everyone out) runs from the management account as a short-lived privileged session (`sts:AssumeRoot`).
- **Management-to-member access role:** every member account keeps the default `OrganizationAccountAccessRole` that Organizations creates. The management account can assume it, and it has administrator permissions. It is a break-glass path only. Daily access uses IAM Identity Center.

### 3. Human access: IAM Identity Center

- IAM Identity Center is enabled in `us-east-1`, in the management account. It uses its own identity store, and MFA is required. MFA is context-aware: it is asked for when the device, browser, or location changes. This fits a single owner. MFA switches to always-on when a second person joins.
- Permission sets:

  | Permission set        | AWS managed policy    | Session duration |
  | --------------------- | --------------------- | ---------------- |
  | `AdministratorAccess` | `AdministratorAccess` | 1 hour           |
  | `ReadOnlyAccess`      | `ReadOnlyAccess`      | 4 hours          |

- Local AWS CLI profiles: `cvt-dev`, `cvt-stag`, `cvt-prod`, and `org-mgmt`. Credentials come from `aws sso login` and expire with the session.
- No IAM users and no access keys, in any account.
- **Why not IAM users:** the alternative was an IAM user in the management account that assumes `OrganizationAccountAccessRole` in each member account. That role is admin-only, so read-only access would need a role created by hand in every account. The identity would also live in the management account, and the work grows with every new account. Identity Center is free and is set up once.

### 4. CI access: GitHub OIDC

Each workload account has one IAM OIDC identity provider for `token.actions.githubusercontent.com`, and one deploy role (`GithubDeployRole`).

- **Trust:** `sts:AssumeRoleWithWebIdentity` only when `aud` is `sts.amazonaws.com` and `sub` is exactly `repo:dhnhut/cv-tailor:environment:<env>`. Trusting the GitHub Environment, not a branch, means the Environment's protection rules (branch filter, and later manual approval for `prod`) also protect the AWS role.
- **Permissions:** only `sts:AssumeRole` on `arn:aws:iam::<account>:role/cdk-*`. The deploy role can't touch any resource directly. It can only hand work to the CDK bootstrap roles.
- The provider and role are defined in CDK (`OidcStack`). They are deployed once per account from a laptop with SSO credentials, because CI can't deploy before the role exists.

### 5. CDK bootstrap trust model

```text
GithubDeployRole (assumed through OIDC)
  └─ cdk-*-deploy-role, cdk-*-file-publishing-role, cdk-*-lookup-role
      └─ cdk-*-cfn-exec-role  (used by CloudFormation only; changes resources)
```

- Each workload account is bootstrapped by itself in `us-east-1`. No account trusts another (`--trust` is not used), because there is no central tooling account. Each environment deploys only inside its own account.
- The CloudFormation execution role keeps the default `AdministratorAccess` policy. This is an accepted risk: only CloudFormation can assume the role, the OIDC trust is narrow, and the SCPs still apply. Scoping it down with `--cloudformation-execution-policies` is the planned hardening step (see "When to revisit").

### 6. Service control policies

AWS allows at most 5 SCPs per target, and `FullAWSAccess` counts as one. Statements are therefore merged into as few policies as possible.

| Attached to | Policy         | Statements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root        | Baseline       | 1. Deny `organizations:LeaveOrganization` and `account:CloseAccount`. Accounts are closed only from the management account, where SCPs don't apply. <br> 2. **Region deny:** deny every action when `aws:RequestedRegion` is not in the allowed list. A `NotAction` list exempts global services (IAM, Organizations, STS, CloudFront, Budgets, Route 53, Support, Cost Explorer, and similar), taken from the AWS example SCP. It also exempts Bedrock inference actions. <br> 3. **Bedrock inference:** deny Bedrock inference actions outside the allowed regions unless the request uses a `us.` inference profile (`bedrock:InferenceProfileArn`). <br> 4. Deny `cloudtrail:StopLogging`, `cloudtrail:DeleteTrail`, `cloudtrail:UpdateTrail`, and `cloudtrail:PutEventSelectors`. |
| `Security`  | Log protection | Deny deleting the trail bucket, deleting objects in it, and changing its bucket policy, lifecycle, Block Public Access, or object ownership. A real change is made by detaching the SCP from the management account, making the change, and attaching it again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Prod`      | None yet       | Reserved for prod-only rules (for example denying deletion of data stores).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

- **Why the baseline attaches to Root:** Root covers every member account, including `log-archive` and future projects, and never covers the management account. One attachment replaces one per OU.
- **Bedrock cross-region inference:** a `us.` inference profile is called in `us-east-1` but can run the request in other US regions. A plain region deny would block those calls, so statement 2 skips Bedrock inference, and statement 3 allows it outside `us-east-1` only through a `us.` profile. This follows the AWS example SCP for cross-region inference. It needs no list of destination regions, so it keeps working when AWS changes a profile's routing, and a direct call to a model in another region is still denied.
- **`cloudtrail:PutEventSelectors`** is denied too, because it can leave a trail turned on while filtering out every event.
- **Allowed regions are org-wide.** Today the list is `us-east-1` only. A future project that needs another region either extends the list or gets its own SCP attached to its accounts.
- **Rollout:** a new SCP is attached to `NonProd` first, verified, and then attached to its final target.
- **Source of truth:** the exact policy JSON is committed under `infra/org/scps/` in S1-05, with the AWS example it was taken from, and a test in CI checks it. This ADR records the design. It doesn't copy lists that change over time.
- **Existing policy:** the `DenyLeaveAndCloseAccount` SCP, attached to Root while the accounts were created, becomes statement 1 of the baseline policy in S1-05. It is then detached, so Root stays within the 5-SCP limit.

### 7. Organization CloudTrail

- One organization trail, defined in the management account, logs management events from every account in every region.
- It delivers to an S3 bucket in `log-archive` with:
  - Block Public Access on, and object ownership set to `BucketOwnerEnforced` (ACLs off),
  - SSE-S3 encryption (a KMS key would add USD 1 per month and a key policy to maintain),
  - a bucket policy that allows only the CloudTrail service, scoped by `aws:SourceArn` to the trail's ARN, and denies requests without TLS,
  - a lifecycle rule that expires logs after 90 days. Logs are not moved to Glacier: CloudTrail writes many files of a few KB, so the per-object transition fees and Glacier's per-object overhead would cost more than the storage saved.
- Log file validation is on, so a changed or deleted log file can be detected.
- Member accounts can't change the organization trail, and the Root baseline SCP stops them from turning off any trail they create themselves.

## Consequences

### Positive

- Hard boundaries between environments for permissions, service quotas, and cost. Each account's bill is its environment's cost.
- Shared guardrails are attached once, and every new account inherits them.
- No long-lived AWS credentials exist for people or for CI.
- Audit logs sit outside the management account, the most powerful account in the Organization.
- New projects fit into the existing tree without changes.

### Negative

- Four member accounts to maintain, plus the management account.
- The Organization, Identity Center, SCPs, and trail are set up by hand, not by Control Tower or infrastructure as code. The runbooks (S1-12) and the SCP JSON in the repo record the setup.
- The CloudFormation execution role is broad (`AdministratorAccess`) in each account.
- Every deploy role, bootstrap, and budget is repeated in each workload account.

### Risks and mitigations

| Risk                                                                | Mitigation                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The region-deny SCP blocks Bedrock cross-region inference.          | Bedrock inference outside `us-east-1` is allowed through `us.` inference profiles. A real `converse` call is tested in `dev` before the SCP is attached to Root. |
| A new SCP locks everyone out, including CI.                         | SCPs never apply to the management account, which can detach any SCP. New SCPs go to `NonProd` first.                                                            |
| An OIDC trust that is too broad lets another branch or fork deploy. | The `sub` condition matches one repository and one GitHub Environment exactly. The Environment is limited to `main`. A CDK test checks the trust policy.         |
| Loss of the management account root MFA device.                     | Root is break-glass only. Account recovery goes through AWS Support with the root email address.                                                                 |
| `stag` differs from `prod` once `prod` has its own SCPs.            | Move `stag` into `Prod` or its own OU when prod-only SCPs are added (see below).                                                                                 |

### When to revisit this decision

- **Prod-only SCPs are added:** `stag` should run under the same rules to be a faithful rehearsal of `prod`. Move it into `Prod`, or into its own OU.
- **`dev` needs looser rules than `stag`,** for example for experiments: add a `Sandbox` OU.
- **More than about 10 accounts, or a second person joins:** consider Control Tower, or managing the Organization as code, and switch Identity Center MFA to always-on.
- **`prod` gets real users:** add prod-only SCPs and a manual approval gate on the `prod` GitHub Environment, and scope down the CloudFormation execution role.
- **Identity Center access is proven in every account:** restrict or remove `OrganizationAccountAccessRole`, keeping `sts:AssumeRoot` and the management account as the break-glass path.
- **Identity Center needs day-to-day administration:** delegate it to a member account, so the management account is used even less.

## Verification

1. `aws organizations list-accounts --profile org-mgmt` lists `log-archive`, `cv-tailor-dev`, `cv-tailor-stag`, and `cv-tailor-prod` as `ACTIVE`.
2. `aws organizations list-organizational-units-for-parent` and `list-accounts-for-parent` show the OU tree above.
3. `aws iam list-organizations-features --profile org-mgmt` shows root credentials management turned on.
4. After `aws sso login --profile cvt-dev`, `aws sts get-caller-identity --profile cvt-dev` shows the dev account.
5. `aws dynamodb list-tables --region ap-southeast-2 --profile cvt-dev` is denied by the SCP (`aws s3 ls` is not a valid check, because `s3:ListAllMyBuckets` is a global action), and a Bedrock `converse` call through a `us.` inference profile succeeds.
6. `aws iam get-role --role-name GithubDeployRole --profile cvt-dev` shows the exact `aud` and `sub` conditions.
7. `aws cloudtrail describe-trails --profile org-mgmt` shows `IsOrganizationTrail: true`, and its `S3BucketName` is the bucket in `log-archive`.

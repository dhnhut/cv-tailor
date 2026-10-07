# ADR-0013: Infrastructure as Code with OpenTofu

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-10-07    |
| Deciders    | Project owner |
| Sprint item | S3-15         |

## Context

The infrastructure is an AWS CDK app in `infra/` (S1-06 onwards). It has 13 stacks in four stages per environment:

- `<env>`: the workload. Deployed by CI.
- `<env>-access`: the GitHub OIDC role. Deployed from a laptop.
- `<env>-baseline`: the budget and the kill switch. Deployed from a laptop.
- `<env>-dns`: the hosted zone and the certificate. Deployed from a laptop.

The project should show infrastructure as code in HCL, the language of Terraform and OpenTofu, because it is the most widely used IaC language. Sprint 3 still adds infrastructure: ingestion sync (S3-08), the AgentCore Runtime (S3-10), and the job queue (S3-12). Converting before those items means they are written once.

This ADR settles:

1. The tool.
2. How the code and its state are split.
3. Where state lives, and how it is protected.
4. What CI may change, now that no CloudFormation role stands between CI and AWS.
5. How data is protected against replacement and deletion.
6. How values shared with the TypeScript code stay in step.
7. How the move from CDK happens.

Numbers in square brackets refer to [Sources](#sources).

### Decision drivers

1. **HCL**, so the infrastructure shows the language most IaC jobs use.
2. **No weaker guards.** CI still can't change its own role, the budget, the kill switch, or DNS (ADR-0004 §4, ADR-0008). Data stores still can't be replaced or deleted by a deploy.
3. **No secrets in plain text.** The Google client secret must not sit readable in a state file.
4. **Long-term support.** The tool and its AWS provider must be maintained, and cover every resource the app uses.
5. **Few moving parts** that the owner understands and can maintain.

### What the AWS provider covers

Checked against AWS provider v6.67.0 (2026-09-30):

| Need                                                                                 | Support                                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Bedrock managed knowledge base (`type = "MANAGED"`) and its S3 connector data source | `aws_bedrockagent_knowledge_base` since v6.56.0 [5], `aws_bedrockagent_data_source` [6]             |
| Managed login (version 2) and its branding                                           | `aws_cognito_user_pool_domain`, `aws_cognito_managed_login_branding` [7]                            |
| Refresh token rotation                                                               | `refresh_token_rotation` on `aws_cognito_user_pool_client` [7]                                      |
| AgentCore Runtime (S3-10)                                                            | `aws_bedrockagentcore_agent_runtime` [7]                                                            |
| The Google client secret kept out of state (a write-only argument)                   | **Not supported.** `aws_cognito_identity_provider` takes the secret in `provider_details` only [7]. |

## Options Considered

### Option A: Stay on AWS CDK

- **Pros:** no work. CloudFormation handles rollback, and the deploy role only hands work to CloudFormation (ADR-0004 §5).
- **Cons:** fails driver 1.

Rejected.

### Option B: CDK for Terraform (CDKTF)

TypeScript that generates Terraform configuration.

- **Pros:** the stacks would stay in TypeScript.
- **Cons:** HashiCorp archived CDKTF on 2025-12-10, and it gets no more fixes [1]. Fails driver 4. The output is generated JSON, not HCL, so it also fails driver 1.

Rejected.

### Option C: Terraform

HashiCorp's CLI, under the Business Source License 1.1. That licence allows this use.

- **Pros:** the name job ads use. The widest documentation.
- **Cons:** state is plain JSON. The only protection for the Google client secret in state is S3 encryption at rest and IAM. Anyone who can read the state object can read the secret.

Not chosen, because it fails driver 3.

### Option D: OpenTofu (chosen)

The open-source fork of Terraform under the Linux Foundation (MPL 2.0). It uses the same HCL and the same providers.

- **Pros:**
  - It encrypts state and plan files on the client before they are written, with a key from AWS KMS [2]. A reader of the state bucket without the KMS key sees only ciphertext.
  - Native S3 locking, so no lock table is needed [3].
  - Everything except the `encryption` block also runs on Terraform.
- **Cons:**
  - A smaller community than Terraform.
  - The `encryption` block is OpenTofu-only.
  - Losing the KMS key makes the state unreadable [2].

## Decision

**OpenTofu, with one encrypted state file per environment and stack, in an S3 bucket in each account.**

### 1. Tool and versions

- OpenTofu 1.13 (`required_version = "~> 1.13.0"`) and the AWS provider 6.x, from v6.67 (`~> 6.67`).
- Each root module commits its `.terraform.lock.hcl`, with hashes for `linux_amd64` (CI) and `linux_arm64` (the devcontainer).
- The devcontainer and CI install pinned versions of `tofu`, `tflint`, and `trivy`. In CI, the setup actions are pinned to commit SHAs and updated by Dependabot, as today.

### 2. Layout and state

```text
infra/
  modules/   reusable pieces: settings, lambda-function, oidc, budget, kill-switch, zone,
             certificate, data, knowledge-base, auth, auth-domain, web, api
  stacks/    root modules, one state each: bootstrap, access, baseline, dns, workload
  generated/ contracts.json, written by packages/contracts (point 7)
  scripts/   tofu.sh, tofu-each.sh, lint-tofu.sh, web-config.ts, deploy-web.sh
```

- `modules/settings` holds each environment's committed settings: host, budget, Google client ID, DNS delegations, and the kill switch's initial value. Every stack reads its environment's values from it, so a value lives in one place, and its validations and tests replace the CDK app's `config/environments.ts`. A module, not `.tfvars` files, because each stack needs a different subset, and a shared `.tfvars` file warns about every variable a stack doesn't declare.
- The stacks keep the CDK stage boundaries: `access`, `baseline`, and `dns` are deployed from a laptop, and `workload` by CI.
- State key: `<env>/<stack>.tfstate`. Separate root modules, not workspaces, because a separate state key per stack lets IAM limit CI to the `workload` state (point 5).
- Inside `workload`, resources reference each other directly. The SSM parameters and the explicit stack dependencies that CDK needed between stacks go away.
- The workload finds the zone and the certificate by name, with `data "aws_route53_zone"` and `data "aws_acm_certificate"`. The two DNS parameters in SSM (`/cv-tailor/dns/*`) are dropped.
- SSM parameters that something outside the infrastructure code reads are kept:
  - the knowledge base IDs and the bucket name (S3-10)
  - the user pool and client IDs (runbooks)
  - `/cv-tailor/ai-calls`
- `infra/scripts/tofu.sh <env> <stack> <command>` is the only way to run OpenTofu:
  - It takes exactly one environment and one stack. Nothing deploys "everything", which keeps the "never `'**'`" rule.
  - It reads `CVT_<ENV>_ACCOUNT_ID` and `CVT_ALERT_EMAIL` from the shell or `infra/.env`, as today (ADR-0004 §2). Account IDs are still not committed.
  - It sets the backend bucket and key, and a separate `TF_DATA_DIR` per environment.

### 3. Account pinning

- Every AWS provider block sets `region = "us-east-1"` (ADR-0002) and `allowed_account_ids = [var.account_id]`. A plan fails at once if the credentials belong to another account. This replaces the CDK Stage `env`.
- `default_tags` tags every resource with `Project`, `Environment`, and `Stack`.
- Variable validations replace the TypeScript config checks: 12-digit account ID, email format, a delegated zone is a subdomain, and so on.

### 4. State backend and encryption

- **`bootstrap` stack, per account:** an S3 bucket `cv-tailor-tfstate-<account>` and a KMS key with alias `alias/cv-tailor-tfstate`. Deployed once from a laptop with `tofu.sh <env> bootstrap create`, which starts with local state and then moves it into the new bucket (`tofu init -migrate-state`).
- **The bucket:** versioning on (each state version can be restored), all public access blocked, TLS only, bucket-owner-enforced object ownership, `prevent_destroy`.
- **Locking:** native S3 locking (`use_lockfile = true`) [3].
- **Encryption:** every stack except `bootstrap` has `encryption { key_provider "aws_kms" … method "aes_gcm" … }` for state and plan, with `enforced = true` [2]. OpenTofu then refuses to write unencrypted state. `bootstrap` creates the key, so its state can't depend on it. That state holds no secrets, only the bucket's and the key's settings, and the bucket encrypts it at rest with the same key.
- **The KMS key:** a 30-day deletion window and `prevent_destroy`. Its key policy delegates to IAM in the same account, so access comes from IAM policies: SSO administrators and `GithubDeployRole`.

### 5. CI access (replaces ADR-0004 §4 "Permissions" and §5)

The OIDC trust is unchanged: the same `aud` and the exact immutable `sub` for the GitHub Environment (ADR-0004 §4).

CloudFormation's execution role is gone, so `GithubDeployRole` calls AWS itself. Its policy, defined in the `access` stack and changed only from a laptop:

**Allows:**

- Read and write on its environment's `workload` state key only (`<env>/workload.tfstate` and its lock file), and `kms:Decrypt` and `kms:GenerateDataKey` on the state key.
- The workload's services, limited to `cv-tailor-<env>-*` names, `/cv-tailor/*` parameters, and the Google client secret: Lambda, API Gateway, Cognito, DynamoDB, S3, CloudFront, Bedrock knowledge bases, SSM, CloudWatch Logs, Secrets Manager (read only), and later SQS and AgentCore.
- Record changes in its own hosted zone, only for `<host>`, `api.<host>`, and `auth.<host>` (`route53:ChangeResourceRecordSetsNormalizedRecordNames`).
- IAM roles and policies for the workload, under the path `/cv-tailor/workload/` only. A role can be created only with the permissions boundary `CvTailorWorkloadBoundary` attached (`iam:PermissionsBoundary` condition). `iam:PassRole` covers those roles only.

**Explicitly denies:**

- Any change to `GithubDeployRole` itself, to the boundary policy, or to the OIDC provider.
- `budgets:*`.
- Writes to `/cv-tailor/ai-calls`.
- Creating or deleting hosted zones.
- Any other state key.

**The permissions boundary** is a managed policy in the `access` stack. It is the most that any workload role can ever do, whatever its own policy says. It allows the data, storage, logging, and Bedrock actions the workload needs, and denies all IAM, Organizations, and account actions. Because of it, a change to the pipeline or the HCL can't create a role with more power than the boundary.

This role is broader than the CDK one, which could only hand work to CloudFormation. Point 5 is what keeps it inside the workload. Exact-match tests pin the policy, and the IAM policy simulator checks it live (see [Verification](#verification)).

### 6. Guards against data loss

| CDK guard                                     | OpenTofu guard                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RemovalPolicy.RETAIN` and a fixed logical ID | `lifecycle { prevent_destroy = true }` on the user pool, the data table, the documents bucket, the hosted zones, the state bucket, and the KMS key. A plan that would replace or destroy one of them fails. |
| Termination protection                        | `prevent_destroy`, and CI can only apply the `workload` state (point 5).                                                                                                                                    |
| Resource deletion protection                  | Unchanged: on for the user pool and the table, and the `DenyBucketDeletion` statement on the documents bucket.                                                                                              |
| Kill switch reset by a baseline deploy        | `lifecycle { ignore_changes = [value] }`: the committed value is used only when the parameter is created. An apply never resets the switch.                                                                 |

A refactor that moves a resource uses a `moved` block, so the resource is kept and not replaced.

### 7. Values shared with TypeScript

- `packages/contracts/scripts/generate.ts` also writes `infra/generated/contracts.json`, for example `DOCUMENTS_KEY_PREFIX`. HCL reads it with `jsondecode(file(...))`. CI's existing contracts drift check covers the file ([ADR-0003](0003-contracts-codegen.md)).
- `infra/scripts/web-config.ts` builds `/config.json` from `tofu output -json` and checks it with `WebConfig.parse` before upload. This keeps the check CDK ran at synth.

### 8. Web app upload

CDK's `BucketDeployment` becomes `infra/scripts/deploy-web.sh`, which runs after `tofu apply`:

1. Upload `assets/` with a one-year immutable cache, without deleting old files.
2. Upload the other files and `config.json` with `no-cache`, deleting files that are gone.
3. Invalidate the CloudFront distribution.

The order and the cache rules are the same as before (S2-04).

### 9. Checks

| Check                                                                                         | Where            |
| --------------------------------------------------------------------------------------------- | ---------------- |
| `tofu fmt -check`, `tflint` with the AWS ruleset                                              | `pnpm run lint`  |
| `tofu test` for every module and stack, with a mocked AWS provider and plan-time assertions   | `pnpm run test`  |
| `tofu validate` for every stack                                                               | `pnpm run build` |
| `trivy config infra`: fails on HIGH or CRITICAL, and any ignored finding has a written reason | CI `check` job   |
| Vitest for `web-config.ts` and the organization policy files, at 80% coverage                 | `pnpm run test`  |

`tofu test` replaces the CDK template tests: exact IAM action lists, `connector_parameters`, user pool settings, the client's OAuth flows and scopes, the CSP header, and the SPA routing function.

### 10. Moving from CDK

- **Recreated:** every resource CloudFormation manages. `dev` holds only test data, so its users, documents, and table items are lost and re-created by hand.
- **Imported:** only the hosted zones `cv.ikiwii.com` (prod) and `dev.cv.ikiwii.com` (dev). A new zone gets new name servers, which would break the delegation from the registrar and from the parent zone. CDK already retains both zones when their stacks are deleted.
- **Order:**
  1. Bootstrap all three accounts.
  2. Tear down the `dev` workload, including the retained resources.
  3. Recreate `access` and `baseline` in all three accounts.
  4. Delete the DNS stacks, import the zones, and apply `dns`.
  5. Apply `workload`.
  6. Delete `CDKToolkit`.

  The deploy runbook gives the commands. `dev.cv.ikiwii.com` is undelegated for a few minutes during step 4.

- The emergency-deny SCP loses its exemption for `cdk-*-cfn-exec-role-*`. Teardown in an emergency runs as the `AdministratorAccess` SSO role, which is already exempt.

## Consequences

### Positive

- The infrastructure is in HCL, with modules, tests, linting, and security scanning.
- The Google client secret in state is encrypted with KMS before it leaves the machine.
- The kill switch can no longer be reset by an apply.
- No CloudFormation bootstrap stack, staging bucket, or asset publishing roles.
- Fewer SSM parameters and no stack dependencies by hand: references inside `workload` set the order.

### Negative

- CI's role can change workload resources directly. The permissions boundary and the explicit denies are what keep it in bounds, and they must be kept up to date.
- A new kind of workload role (for example the AgentCore Runtime role in S3-10) may need a wider boundary. That is a laptop change to `access` before the CI deploy that uses it.
- No automatic rollback. A failed apply leaves the resources it finished, and the fix is a new commit or a re-run.
- The REST API, its CORS preflights, and its deployment trigger are written out in full. CDK generated them.
- `dev` data is lost in the move.
- `prevent_destroy` protects a resource only while its block is in the code. Deleting the block removes the guard.

### Risks and mitigations

| Risk                                                                                               | Mitigation                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The KMS key is lost, and with it every state file.                                                 | `prevent_destroy` on the key and a 30-day deletion window. A scheduled deletion can be cancelled, and the key's CloudTrail events show who scheduled it. |
| A deploy role policy is too broad, or too narrow and blocks a deploy.                              | Exact-match tests in `tofu test`, and an IAM policy simulator check after every change to `access`.                                                      |
| A resource is replaced by accident, for example after a change to a field that forces replacement. | `prevent_destroy` fails the plan for every data store. The deploy runbook says to read every `-/+` in a plan before merging.                             |
| The AWS provider changes a default in a minor version.                                             | The lock file pins exact versions. Dependabot updates them in their own PRs, and the plan for `dev` is read before merging.                              |
| Something changes a resource outside OpenTofu (drift).                                             | `tofu.sh <env> <stack> plan` shows it. The runbook asks for a plan of each laptop stack every sprint.                                                    |

### When to revisit this decision

- A second person deploys: add a plan on every PR with a read-only role, and a manual approval for applies.
- `prod` gets a workload: CI deploys `stag` and `prod` with their own roles and GitHub Environments, and `prod` gets a manual approval gate.
- Terraform adds client-side state encryption, or the Cognito identity provider gets a write-only secret: Terraform becomes an option again.

## Verification

1. `pnpm run check` passes, including `tofu fmt`, `tflint`, `tofu test` for every module and stack, `tofu validate`, and vitest with 80% coverage. `trivy config infra` reports no HIGH or CRITICAL finding without a written reason.
2. After each apply, `tofu.sh <env> <stack> plan` shows no changes.
3. After the zones are imported, the plan shows no changes, and public DNS returns the same name servers as before.
4. `aws iam simulate-principal-policy` with `GithubDeployRole` gives `explicitDeny` for `budgets:ModifyBudget`, `route53:DeleteHostedZone`, `ssm:PutParameter` on `/cv-tailor/ai-calls`, and `iam:CreateRole` without the boundary.
5. The `workload` state object in S3 is ciphertext, and doesn't contain `client_secret`.
6. `tofu.sh dev workload plan -destroy` fails on the user pool, the data table, and the documents bucket.
7. The first CI deploy after the move is green and applies no changes.
8. No CloudFormation stack is left in any of the three accounts.

## Sources

Accessed 2026-10-07.

1. HashiCorp, Terraform CDK repository, archived 2025-12-10: <https://github.com/hashicorp/terraform-cdk>
2. OpenTofu, State and plan encryption: <https://opentofu.org/docs/language/state/encryption/>
3. OpenTofu, S3 backend (`use_lockfile`): <https://opentofu.org/docs/language/settings/backends/s3/>
4. OpenTofu releases (v1.13.1, 2026-10-01): <https://github.com/opentofu/opentofu/releases>
5. terraform-provider-aws PR #48904, "Add Managed Knowledge Base support (type=MANAGED)", released in v6.56.0: <https://github.com/hashicorp/terraform-provider-aws/pull/48904>
6. terraform-provider-aws, `aws_bedrockagent_data_source` (v6.67.0): <https://github.com/hashicorp/terraform-provider-aws/blob/v6.67.0/website/docs/r/bedrockagent_data_source.html.markdown>
7. terraform-provider-aws resource documentation (v6.67.0): <https://github.com/hashicorp/terraform-provider-aws/tree/v6.67.0/website/docs/r>

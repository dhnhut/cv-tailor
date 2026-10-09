# 10 Infrastructure

**Time:** 6 hours · **Week:** 3 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Understand how every AWS resource is described in OpenTofu, who applies which part, what protects the system, and how the infrastructure is tested without AWS.

## Before you start

- [09 Agents](09-agents.md) done.

## Learn first

- [02 Learning path](02-learning-path.md): 12 (cloud basics) and 13 (OpenTofu).

## Read

1. [ADR-0004](../adr/0004-accounts-and-access.md), §1 to §3. Look for: one AWS account per environment, and how people sign in.
2. [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md), Context and Decision. Look for: the five stacks, each with its own encrypted state, and what CI may change.
3. [Deploy and rollback runbook](../runbooks/deploy-and-rollback.md), "What deploys where". Look for: which stack CI applies, and which ones only a person applies from a laptop.
4. `infra/stacks/workload/main.tf`. Look for: each `module` block, and what it builds.
5. `infra/modules/settings/main.tf`. Look for: the settings for each environment, written once.
6. `infra/modules/lambda-function/main.tf` and `variables.tf`. Look for: one function, its role, its log group, and the inline policy named `Calls`.
7. `infra/modules/data/main.tf`. Look for: the guards that keep the table from being deleted (`prevent_destroy`, deletion protection, point-in-time recovery).
8. Tests: `infra/stacks/workload/tests/api.tftest.hcl` and `lambda.tftest.hcl`, and `infra/test/stacks.test.ts`. Look for: `mock_provider` (no AWS), `command = plan` (nothing is created), and `expect_failures`.

### Five stacks

| Stack       | What it holds                                            | Applied by                   |
| ----------- | -------------------------------------------------------- | ---------------------------- |
| `bootstrap` | The bucket and key for OpenTofu's state                  | A person, once per account   |
| `access`    | How CI signs in (OIDC) and what it may do                | A person, from a laptop      |
| `baseline`  | The monthly budget and the kill switch                   | A person, from a laptop      |
| `dns`       | The domain's hosted zone and certificate                 | A person, from a laptop      |
| `workload`  | The application: table, buckets, user pool, web app, API | CI, on every merge to `main` |

You never apply any of them (rule 3). You read them, and you test them on your computer.

## Do

Use [the practice routine](README.md#the-practice-routine) for I2 to I5.

### I1 Validate and test `[No AWS]`

```bash
bash infra/scripts/tofu-each.sh validate
bash infra/scripts/tofu-each.sh test
```

Expected: for each stack, `Success! The configuration is valid.`, then a line such as `Success! 13 passed, 0 failed.` The first run downloads the providers. These commands never reach AWS: `init` skips the remote state, and the tests use a mocked AWS provider.

### I2 Predict what a test checks `[No AWS]`

Read the run `refuses_a_name_the_deploy_role_cannot_manage` in `infra/stacks/workload/tests/lambda.tftest.hcl`. What does `expect_failures = [var.name]` check? Find the rule in `infra/modules/lambda-function/variables.tf`.

Then loosen that rule: change `^cv-tailor-(dev|stag|prod)-[a-z0-9-]+$` to `^[a-z0-9-]+$`, and run `bash infra/scripts/tofu-each.sh test`.

Expected: in `stacks/workload`, `run "refuses_a_name_the_deploy_role_cannot_manage"... fail`, with `Missing expected failure`: the test expected `var.name` to refuse the name `me`, and it didn't. Why does the name matter? CI's role may manage only resources whose names start with `cv-tailor-<env>-` ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md) §5). Reset.

### I3 Give a function one more permission `[No AWS]`

In `infra/modules/api/main.tf`, add `"dynamodb:Query"` to the `me` function's statement, after `"dynamodb:PutItem"`. Run the tests again.

Expected: in `stacks/workload`, `run "api"... fail`: `A function's calls changed. Update this test only after reviewing what the code now calls.` Every function's policy is pinned exactly, so a permission is never added by accident. Reset.

### I4 The region rule `[No AWS]`

Add the line `# ap-southeast-2` at the end of `infra/modules/data/main.tf`. Run:

```bash
pnpm --filter @cv-tailor/infra exec vitest run test/stacks.test.ts
```

Expected: 1 failure: "no OpenTofu file names a region other than us-east-1" ([ADR-0002](../adr/0002-aws-region.md)). Even a comment counts, so a region can't slip in. Reset.

### I5 Formatting `[No AWS]`

In `infra/modules/data/main.tf`, put extra spaces around one `=`, for example `billing_mode   =   "PAY_PER_REQUEST"`. Run:

```bash
tofu fmt -check -recursive infra; echo "exit code: $?"
tofu fmt -recursive infra
git diff
```

Expected: the check names `infra/modules/data/main.tf` and exits with a non-zero code; `tofu fmt` fixes it, and `git diff` shows nothing left.

## Verify

You can name the five stacks, say who applies each one, and explain how `tofu test` checks a plan without AWS.

## Check your understanding

1. Why five stacks, each with its own state?

   <details>
   <summary>Answer</summary>

   A smaller blast radius, and different owners: CI applies only `workload`, so a CI deploy can never change how CI itself signs in (`access`), the budget, the kill switch, or the domain.

   </details>

2. What does `expect_failures = [var.name]` mean?

   <details>
   <summary>Answer</summary>

   The run passes only if the validation on `var.name` refuses the input. It proves that a bad value is caught.

   </details>

3. How do the infrastructure tests run without AWS?

   <details>
   <summary>Answer</summary>

   A mocked AWS provider, runs with `command = plan` (nothing is created), `init` without the remote state, and stub Lambda bundles in `tests/fixtures/bundles/`.

   </details>

4. Why can't your read-only access run `infra/scripts/tofu.sh … plan`?

   <details>
   <summary>Answer</summary>

   The state is encrypted with a KMS key, and the plan reads the Google client secret. `ReadOnlyAccess` can decrypt neither ([account access runbook](../runbooks/account-access.md#if-it-fails)).

   </details>

5. A plan wants to remove `prevent_destroy` from the table to get through. What do you do?

   <details>
   <summary>Answer</summary>

   Stop, and tell your mentor. `prevent_destroy` guards data that can't be recovered. It's never removed to make a plan pass.

   </details>

## If you get stuck

- `tofu-each.sh` fails at `init` with a download error: it needs internet the first time. Run it again.
- The output is long: search it for `fail` and `Error`.

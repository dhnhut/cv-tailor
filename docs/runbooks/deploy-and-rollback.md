# Deploy and Rollback

How CV Tailor's infrastructure gets to AWS, how to preview and recover a deploy, and how to set up a new account. The design is in [ADR-0004](../adr/0004-accounts-and-access.md) §4–5.

## When to use

- Checking that a merge reached `dev`.
- Previewing what a change will do before merging it.
- Changing the GitHub OIDC role or a budget (laptop-only stages).
- Setting up a new environment account.
- A deploy failed, or a deploy succeeded but broke something.

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. `infra/.env` exists and has the three account IDs and the alert email ([account access, step 2.4](account-access.md#2-new-machine-setup)). The CDK app builds every stage, so it needs all four values even when you work on one environment.
3. Dependencies are installed: `pnpm install`.
4. For CI tasks, the GitHub CLI is signed in: `gh auth status`.

## What deploys where

The CDK app has three stages for each environment. Each stage is deployed separately.

| Stage            | Stacks (CloudFormation name)                                        | Deployed by                               | When                           |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `<env>`          | The workload: `<env>-CvTailor-Hello` today                          | CI (`dev` only, on every merge to `main`) | Every merge                    |
| `<env>-access`   | `<env>-access-GithubOidc`: the OIDC provider and `GithubDeployRole` | Laptop only                               | Only when the CI trust changes |
| `<env>-baseline` | `<env>-baseline-Budget`: the monthly budget                         | Laptop only                               | Only when the budget changes   |

Rules:

- **Never deploy with `'**'`.** Always name one stage, for example `'dev/*'`. CI must never be able to change the role it signs in with, or the budget that watches it (ADR-0004 §4).
- `stag` and `prod` have no workload yet (Sprint 1 scope). Only their `-access` and `-baseline` stages exist.
- `CDKToolkit`, `<env>-access-GithubOidc`, and `<env>-baseline-Budget` have termination protection. Deleting one needs `aws cloudformation update-termination-protection --no-enable-termination-protection` first, and should almost never happen.

## 1. Normal deploy (CI)

1. Merge the PR into `main`. The `CI` workflow runs `check`, then `deploy-dev`, which runs `cdk deploy 'dev/*'` with `GithubDeployRole`.
2. Watch it:

   ```bash
   gh run list --workflow ci.yml --branch main --limit 3
   gh run watch <run-id> --exit-status
   ```

3. Check the stack in AWS:

   ```bash
   aws cloudformation describe-stacks --stack-name dev-CvTailor-Hello --profile cvt-dev \
     --query 'Stacks[0].[StackStatus,Outputs[0].OutputValue]' --output text
   ```

   Expected: `UPDATE_COMPLETE` or `CREATE_COMPLETE`, and `hello from cv-tailor`.

## 2. Preview a change

From your branch, before you open or merge the PR:

```bash
pnpm --filter infra exec cdk diff 'dev/*' --profile cvt-dev
```

`There were no differences` means the merge won't change `dev`. Read every `[-]` (removed) and `[~]` (replaced) resource carefully. A replaced resource with data in it loses the data.

## 3. Laptop-only deploys (`-access` and `-baseline`)

Example: changing the `dev` budget.

```bash
pnpm --filter infra exec cdk diff 'dev-baseline/*' --profile cvt-dev
pnpm --filter infra exec cdk deploy 'dev-baseline/*' --profile cvt-dev
```

Use `'<env>-access/*'` for the OIDC role, and `--profile cvt-<env>` for other environments. The stage pins its account, so CDK refuses to deploy if the profile belongs to another account.

After an `-access` change, check the trust in AWS:

```bash
aws iam get-role --role-name GithubDeployRole --profile cvt-dev \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
```

Expected: `aud` is `sts.amazonaws.com` and `sub` is exactly `repo:dhnhut@5567608/cv-tailor@1386961484:environment:dev`. This is GitHub's immutable subject format, which includes the owner and repository IDs. A `sub` without the `@<id>` parts never matches, and the job fails at the credentials step.

## 4. Set up a new environment account

For an account that already exists in the Organization and has SSO access ([account access, step 3](account-access.md#3-give-the-sso-group-access-to-a-new-account)). Example: `stag`.

1. Add the account ID to `infra/.env` (`CVT_STAG_ACCOUNT_ID`).
2. Bootstrap CDK in `us-east-1`:

   ```bash
   ACCOUNT=$(aws sts get-caller-identity --profile cvt-stag --query Account --output text)
   pnpm --filter infra exec cdk bootstrap "aws://$ACCOUNT/us-east-1" --profile cvt-stag --termination-protection
   ```

3. Deploy the budget first, so cost is watched before anything else runs, then the CI role:

   ```bash
   pnpm --filter infra exec cdk deploy 'stag-baseline/*' --profile cvt-stag
   pnpm --filter infra exec cdk deploy 'stag-access/*' --profile cvt-stag
   ```

4. In GitHub, only when CI should deploy this environment: Settings → Environments → **New environment** named exactly after the environment (`stag`). Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main` (a custom rule, not "Protected branches"). Then add the secrets:

   ```bash
   for env in dev stag prod; do
     aws sts get-caller-identity --profile "cvt-$env" --query Account --output text \
       | gh secret set "CVT_${env^^}_ACCOUNT_ID" --env stag
   done
   gh secret set CVT_ALERT_EMAIL --env stag   # paste the address when asked
   ```

   The `dev` workflow job is hard-wired to the `dev` Environment. A `stag` pipeline is new work, not part of this runbook.

5. Check:

   ```bash
   aws budgets describe-notifications-for-budget --profile cvt-stag \
     --account-id "$(aws sts get-caller-identity --profile cvt-stag --query Account --output text)" \
     --budget-name cv-tailor-stag-monthly --query 'length(Notifications)'
   gh secret list --env stag
   ```

   Expected: `5` notifications, and four secrets.

## 5. A deploy failed

CloudFormation rolls a failed update back to the last working state by itself. Nothing in AWS is half-changed once the rollback finishes.

1. Find the reason. The first `*_FAILED` event from the bottom of the list is the cause; the later ones are side effects.

   ```bash
   aws cloudformation describe-stack-events --stack-name dev-CvTailor-Hello --profile cvt-dev --max-items 20 \
     --query 'StackEvents[].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table
   ```

   If the job failed before CloudFormation started (install, credentials, or synth errors), read the job log instead: `gh run view <run-id> --log-failed`.

2. Act on the stack status:

   | Stack status                                  | What to do                                                                                                                                                                                                                                                                            |
   | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `UPDATE_ROLLBACK_COMPLETE`                    | Back on the previous version. If the error was transient (throttling, a timeout), rerun the job: `gh run rerun <run-id> --failed`. Otherwise fix the code in a new PR.                                                                                                                |
   | `ROLLBACK_COMPLETE` (the first create failed) | The stack can't be updated. Delete it, then rerun the job: `aws cloudformation delete-stack --stack-name dev-CvTailor-Hello --profile cvt-dev`.                                                                                                                                       |
   | `UPDATE_ROLLBACK_FAILED`                      | CloudFormation couldn't undo a resource. Fix the cause shown in the events, then `aws cloudformation continue-update-rollback --stack-name dev-CvTailor-Hello --profile cvt-dev`. Skipping resources with `--resources-to-skip` is a last resort, because it leaves them out of sync. |
   | `*_IN_PROGRESS`                               | Wait. The workflow never cancels a running deploy (`cancel-in-progress: false`).                                                                                                                                                                                                      |

3. CI-only errors:

   | Error in the job log                                                                                                            | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `Not authorized to perform sts:AssumeRoleWithWebIdentity`                                                                       | The job's Environment or branch doesn't match the role trust. Check that the job runs in the `dev` Environment from `main`, and check the trust as in [step 3](#3-laptop-only-deploys--access-and--baseline).                                                                                                                                                                                                                                                                                                                                                                                                |
   | `Missing or invalid settings: CVT_…`                                                                                            | A secret is missing from the `dev` Environment: `gh secret list --env dev`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
   | `BootstrapVersionSsmConfirmationFailed … not authorized to perform: ssm:GetParameter … because no identity-based policy allows` | Usually `EmergencyDeny` is attached to the account, which is expected during an incident ([budget alarm runbook](budget-alarm.md#5-emergency-stop)). The SCP denies `GithubDeployRole` when it assumes the CDK deploy role, CDK falls back to the role's own credentials, and those have no SSM permission, so the log shows this error instead of the SCP one. To confirm, look for `sts:AssumeRole` with `explicit deny in a service control policy` in CloudTrail: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRole --max-results 5 --profile cvt-dev`. |

## 6. Roll back a deploy that succeeded but is wrong

### Default: revert and redeploy through CI

```bash
git switch main && git pull
git switch -c revert/<short-name>
git revert <bad-commit-sha>
git push -u origin HEAD
gh pr create --fill
```

Merge the PR when CI is green. CI deploys the reverted code, so `main` and `dev` stay the same. This is the only rollback that doesn't leave `dev` different from `main`.

### Emergency: deploy an earlier commit from the laptop

Only when CI can't deploy (for example, GitHub Actions is down) and `dev` must be fixed now.

```bash
git switch --detach <last-good-commit-sha>
pnpm install --frozen-lockfile
pnpm --filter infra exec cdk diff 'dev/*' --profile cvt-dev
pnpm --filter infra exec cdk deploy 'dev/*' --profile cvt-dev
git switch -
```

Then still open the revert PR above. The next merge to `main` redeploys whatever `main` holds and undoes the emergency deploy.

### Rollback restores infrastructure, not data

A rollback puts resources back to their earlier definition. It doesn't bring back deleted data. Today `dev` has no data stores, so this is safe. When DynamoDB tables and S3 buckets are added, they need a retain removal policy and point-in-time recovery or versioning, and this runbook needs a data restore section.

## Verify

- `pnpm --filter infra exec cdk diff 'dev/*' --profile cvt-dev` prints `There were no differences` on `main`.
- The latest `CI` run on `main` is green, including `deploy-dev / deploy`: `gh run list --workflow ci.yml --branch main --limit 1`.
- `describe-stacks` shows `dev-CvTailor-Hello` with its output, as in [step 1](#1-normal-deploy-ci).

## If it fails

- `Need to perform AWS calls for account …, but no credentials have been configured`: you aren't signed in, or the profile is wrong ([account access](account-access.md)).
- `Missing or invalid settings: CVT_…` on the laptop: `infra/.env` is missing or incomplete.
- `No stacks match the name(s)`: the selector has no `/*`, or the stage name is wrong. List them with `pnpm --filter infra exec cdk list '**'`.
- `This CDK deployment requires bootstrap stack version …`: bootstrap the account again, as in [step 4.2](#4-set-up-a-new-environment-account).

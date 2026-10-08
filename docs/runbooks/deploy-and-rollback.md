# Deploy and Rollback

How CV Tailor's infrastructure gets to AWS, how to preview and recover a deploy, and how to set up a new account. The infrastructure is OpenTofu ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md)), and CI signs in as described in [ADR-0004](../adr/0004-accounts-and-access.md) §4.

## When to use

- Checking that a merge reached `dev`.
- Previewing what a change will do before merging it.
- Changing the GitHub OIDC role, a budget, the kill switch parameter, or DNS (laptop-only stacks).
- Setting up a new environment account.
- A deploy failed, or a deploy succeeded but broke something.
- Moving from CDK to OpenTofu, once ([section 7](#7-move-from-cdk-once-s3-15)).

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. `infra/.env` exists and has the three account IDs and the alert email ([account access, step 2.4](account-access.md#2-new-machine-setup)). `infra/scripts/tofu.sh` needs the environment's account ID, and the baseline stack also needs the alert email.
3. Dependencies and tools are installed: `pnpm install`, and `tofu version` prints `v1.13.1`. The devcontainer installs OpenTofu, TFLint, and Trivy; elsewhere, run `bash .devcontainer/install-iac-tools.sh`.
4. For the workload stack, the build output exists: `pnpm --filter @cv-tailor/web --filter @cv-tailor/api run build`. Every workload plan zips the Lambda bundles in `apps/api/dist`, and `deploy-web.sh` uploads `apps/web/dist`. Build again after changing either app.
5. Choose the account for OpenTofu: `export AWS_PROFILE=cvt-<env>`. `tofu.sh` uses the standard AWS credentials, and every stack refuses to plan against another account (`allowed_account_ids`).
6. For CI tasks, the GitHub CLI is signed in: `gh auth status`.

## What deploys where

Each environment has five stacks. Each stack is a root module in `infra/stacks/` with its own state, `s3://cv-tailor-tfstate-<account>/<env>/<stack>.tfstate`. State and plans are encrypted with the account's `alias/cv-tailor-tfstate` KMS key before they're written.

| Stack       | Holds                                                                                                                                                                                                                                         | Applied by                                | When                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `bootstrap` | The state bucket and the state encryption key                                                                                                                                                                                                 | Laptop only                               | Once per account                                          |
| `access`    | The GitHub OIDC provider, `GithubDeployRole`, and the workload permissions boundary                                                                                                                                                           | Laptop only                               | Only when CI's access changes                             |
| `baseline`  | The monthly budget, and the kill switch parameter `/cv-tailor/ai-calls` (S2-11)                                                                                                                                                               | Laptop only                               | Only when the budget or the kill switch parameter changes |
| `dns`       | The hosted zone and its delegation records, and the certificate for `<host>` and `*.<host>` (`dev` only today, [ADR-0008](../adr/0008-domain-and-dns.md))                                                                                     | Laptop only                               | Only when a zone, delegation, or certificate changes      |
| `workload`  | The data table `cv-tailor-<env>-data` (S2-08), the documents bucket and the knowledge base (S3-06), the user pool and its client (S2-05), the web app (S2-04), the sign-in pages at `auth.<host>`, and the API at `api.<host>` (S2-09, S3-07) | CI (`dev` only, on every merge to `main`) | Every merge                                               |

Rules:

- **Always use `infra/scripts/tofu.sh <env> <stack> <command>`.** It takes exactly one environment and one stack, and sets the state bucket and key. There is no "all stacks" command. CI only ever applies `workload`, and `GithubDeployRole` can't read or write any other stack's state, its own access, the budget, the kill switch, or the hosted zones (ADR-0013 §5).
- `stag` and `prod` have no workload yet. `prod` has its `dns` stack; `stag` gets one with the release path (slice R).
- The workload finds the zone and the certificate by name, so an environment's `dns` stack, with its certificate, must be applied before its first workload apply.
- An environment with a Google client ID in `infra/modules/settings` needs its Google client secret in Secrets Manager before the deploy that adds Google sign-in. OpenTofu reads it when it plans ([Google sign-in runbook](google-sign-in.md#13-store-the-secret)).
- The user pool, the data table, the documents bucket, the hosted zones, the state bucket, the state key, the OIDC provider, `GithubDeployRole`, and the boundary have `prevent_destroy`. A plan that would destroy or replace one of them fails. Never remove that line to get a plan through: find out why the plan wants to replace the resource.
- **Never replace the user pool.** A new pool is empty, and every user would get a new `sub`. Deletion protection keeps the old pool, but nothing would point at it any more.
- **Never replace the data table or the documents bucket.** Their fixed names make a replacement fail, but every user's records and documents would be in a resource nothing points at. The knowledge base and its data source hold no data of their own, so replacing one loses nothing, but it changes its ID in SSM and needs a full sync ([ADR-0007](../adr/0007-knowledge-base-store.md)).
- **An apply never resets the kill switch.** OpenTofu writes its committed value only when it creates the parameter ([kill switch runbook, step 5](kill-switch.md#5-apply-the-baseline-stack-without-resetting-the-switch)).
- A workload plan reads the Google client secret, and the state holds it, encrypted. Plans show it as `(sensitive value)`.

## 1. Normal deploy (CI)

1. Merge the PR into `main`. The `CI` workflow runs `check`, then `deploy-dev`, which plans and applies `dev`'s workload stack with `GithubDeployRole`, then uploads the web app (`infra/scripts/deploy-web.sh`).
2. Watch it:

   ```bash
   gh run list --workflow ci.yml --branch main --limit 3
   gh run watch <run-id> --exit-status
   ```

3. Check that `dev` matches `main`, and that the site is up:

   ```bash
   AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev workload plan
   curl -sI https://dev.cv.ikiwii.com/ | head -1
   ```

   Expected: `No changes.` and `HTTP/2 200`.

## 2. Preview a change

From your branch, before you open or merge the PR:

```bash
AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev workload plan
```

`No changes.` means the merge won't change `dev`. Read every `-/+` (replaced) and `-` (destroyed) resource carefully. A replaced resource with data in it loses the data.

## 3. Laptop-only stacks (`access`, `baseline`, and `dns`)

Example: changing the `dev` budget.

```bash
export AWS_PROFILE=cvt-dev
infra/scripts/tofu.sh dev baseline plan
infra/scripts/tofu.sh dev baseline apply
```

Use `access` for the OIDC role and the boundary, and `AWS_PROFILE=cvt-<env>` for other environments.

After an `access` change, check the trust and the deploy role's limits in AWS:

```bash
aws iam get-role --role-name GithubDeployRole \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" \
  --action-names budgets:ModifyBudget route53:DeleteHostedZone iam:CreateRole iam:DeleteRolePermissionsBoundary \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" \
  --action-names ssm:PutParameter --resource-arns "arn:aws:ssm:us-east-1:$ACCOUNT:parameter/cv-tailor/ai-calls" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
# Name a real function: simulated against *, the allow doesn't match, and the answer is only implicitDeny.
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" \
  --action-names lambda:InvokeFunction --resource-arns "arn:aws:lambda:us-east-1:$ACCOUNT:function:cv-tailor-dev-me" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
# What CI needs: its own state, and the workload's resources.
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" \
  --action-names s3:GetObject s3:PutObject \
  --resource-arns "arn:aws:s3:::cv-tailor-tfstate-$ACCOUNT/dev/workload.tfstate" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" \
  --action-names lambda:CreateFunction --resource-arns "arn:aws:lambda:us-east-1:$ACCOUNT:function:cv-tailor-dev-me" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output table
```

Expected:

- `aud` is `sts.amazonaws.com`, and `sub` is exactly `repo:dhnhut@5567608/cv-tailor@1386961484:environment:dev`. This is GitHub's immutable subject format, which includes the owner and repository IDs. A `sub` without the `@<id>` parts never matches, and the job fails at the credentials step.
- The first three tables: every decision is `explicitDeny`. `iam:CreateRole` is denied because the simulation names no permissions boundary.
- The last two tables: every decision is `allowed`, so the role isn't locked out of its own job.

### DNS zones and certificates (`dns`)

The workload finds the zone and the certificate by the environment's host, so nothing reads IDs from this stack.

First setup of a new zone, in this order. Each step waits for the one before it ([ADR-0008](../adr/0008-domain-and-dns.md)). Example: `stag.cv.ikiwii.com`, once `stag` has DNS settings in `infra/modules/settings`.

1. Create the zone without its certificate first (set `certificate = false` for now), and note its name servers:

   ```bash
   AWS_PROFILE=cvt-stag infra/scripts/tofu.sh stag dns apply
   AWS_PROFILE=cvt-stag infra/scripts/tofu.sh stag dns output name_servers
   ```

2. Delegate it. Copy the four name servers into the `stag.cv.ikiwii.com` entry of `dns.prod.delegations` in `infra/modules/settings/main.tf`, commit, and apply the `prod` zone. It adds the `NS` records for the child zone:

   ```bash
   AWS_PROFILE=cvt-prod infra/scripts/tofu.sh prod dns apply
   ```

   For `cv.ikiwii.com` itself, add four `NS` records for the host `cv` at the registrar of `ikiwii.com` instead.

3. When public DNS returns the four name servers, set `certificate = true` and apply again. ACM checks its validation record through public DNS, so it can't be issued before the delegation works. The apply waits until the certificate is issued, usually a few minutes:

   ```bash
   AWS_PROFILE=cvt-stag infra/scripts/tofu.sh stag dns apply
   ```

Check:

```bash
curl -s 'https://dns.google/resolve?name=cv.ikiwii.com&type=NS' | jq -r '.Answer[].data'
curl -s 'https://dns.google/resolve?name=dev.cv.ikiwii.com&type=NS' | jq -r '.Answer[].data'
aws acm list-certificates --profile cvt-dev \
  --query "CertificateSummaryList[?DomainName=='dev.cv.ikiwii.com'].Status" --output text
```

Expected: the four name servers of each zone, and `ISSUED`.

A new zone gets new name servers, so a zone that is deleted and created again breaks the delegation above it. That's why the zones have `prevent_destroy`, and why the move from CDK imported them ([section 7](#7-move-from-cdk-once-s3-15)).

## 4. Set up a new environment account

For an account that already exists in the Organization and has SSO access ([account access, step 3](account-access.md#3-give-the-sso-group-access-to-a-new-account)). Example: `stag`.

1. Add the account ID to `infra/.env` (`CVT_STAG_ACCOUNT_ID`).
2. Create the state bucket and key. The bucket doesn't exist yet, so `create` keeps the state locally while it creates the bucket, then moves the state into it. It asks you to confirm the apply:

   ```bash
   export AWS_PROFILE=cvt-stag
   infra/scripts/tofu.sh stag bootstrap create
   ```

3. Apply the budget first, so cost is watched before anything else runs, then the CI role:

   ```bash
   infra/scripts/tofu.sh stag baseline apply
   infra/scripts/tofu.sh stag access apply
   ```

4. In GitHub, only when CI should deploy this environment: Settings → Environments → **New environment** named exactly after the environment (`stag`). Under **Deployment branches and tags**, choose **Selected branches and tags** and add `main` (a custom rule, not "Protected branches"). Then add the one secret CI needs:

   ```bash
   aws sts get-caller-identity --profile cvt-stag --query Account --output text \
     | gh secret set CVT_STAG_ACCOUNT_ID --env stag
   ```

   The `dev` workflow job is hard-wired to the `dev` Environment. A `stag` pipeline is new work, not part of this runbook.

5. Check:

   ```bash
   aws budgets describe-notifications-for-budget --profile cvt-stag \
     --account-id "$(aws sts get-caller-identity --profile cvt-stag --query Account --output text)" \
     --budget-name cv-tailor-stag-monthly --query 'length(Notifications)'
   infra/scripts/tofu.sh stag access plan
   ```

   Expected: `5` notifications, and `No changes.`

## 5. A deploy failed

OpenTofu doesn't roll back. A failed plan changes nothing. A failed apply keeps every change it finished, and the state records them, so the next apply continues from there.

1. Find the reason in the job log: `gh run view <run-id> --log-failed`. The first `Error:` is the cause.
2. Act on where it failed:

   | Where                            | What to do                                                                                                                                                                                                                                                            |
   | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Install, build, or credentials   | Nothing in AWS changed. Fix the cause, then rerun the job: `gh run rerun <run-id> --failed`.                                                                                                                                                                          |
   | `tofu plan`                      | Nothing in AWS changed. If the error was transient (throttling, a timeout), rerun the job. Otherwise fix the code in a new PR.                                                                                                                                        |
   | `tofu apply`                     | Some changes may be done. If the error was transient, rerun the job: it plans again from what's there now. Otherwise fix the code in a new PR. Until then, `dev` runs the half-applied change, so check the site and the API.                                         |
   | `deploy-web.sh`                  | The infrastructure is applied, but the web files may be old. Rerun the job.                                                                                                                                                                                           |
   | `Error acquiring the state lock` | Another apply holds the lock. The workflow never runs two at once (`concurrency`), so wait for it. If a run was killed and left the lock, and no run is going, remove it from the laptop: `infra/scripts/tofu.sh dev workload force-unlock <lock ID from the error>`. |

3. CI-only errors:

   | Error in the job log                                                                  | Cause and fix                                                                                                                                                                                                                                                                    |
   | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `Not authorized to perform sts:AssumeRoleWithWebIdentity`                             | The job's Environment or branch doesn't match the role trust. Check that the job runs in the `dev` Environment from `main`, and check the trust as in [step 3](#3-laptop-only-stacks-access-baseline-and-dns).                                                                   |
   | `CVT_DEV_ACCOUNT_ID must be a 12-digit account ID`                                    | The secret is missing from the `dev` Environment: `gh secret list --env dev`.                                                                                                                                                                                                    |
   | `AccessDenied` or `not authorized to perform` on a workload action                    | `GithubDeployRole` lacks a permission the change needs. Check whether the action should be allowed (ADR-0013 §5). If so, add it to `infra/modules/oidc`, apply the `access` stack from the laptop ([step 3](#3-laptop-only-stacks-access-baseline-and-dns)), then rerun the job. |
   | `explicit deny in a service control policy`, or `Unable to build encryption key data` | Usually `EmergencyDeny` is attached to the account, which is expected during an incident ([budget alarm runbook](budget-alarm.md#5-emergency-stop)). OpenTofu can't read its encrypted state, so the job fails before any change.                                                |

## 6. Roll back a deploy that succeeded but is wrong

### Default: revert and redeploy through CI

```bash
git switch main && git pull
git switch -c revert/<short-name>
git revert <bad-commit-sha>
git push -u origin HEAD
gh pr create --fill
```

Merge the PR when CI is green. CI applies the reverted code, so `main` and `dev` stay the same. This is the only rollback that doesn't leave `dev` different from `main`.

### Emergency: apply an earlier commit from the laptop

Only when CI can't deploy (for example, GitHub Actions is down) and `dev` must be fixed now.

```bash
git switch --detach <last-good-commit-sha>
pnpm install --frozen-lockfile
pnpm --filter @cv-tailor/web --filter @cv-tailor/api run build
export AWS_PROFILE=cvt-dev
infra/scripts/tofu.sh dev workload plan -out=tfplan
infra/scripts/tofu.sh dev workload apply tfplan
infra/scripts/deploy-web.sh dev
git switch -
```

Then still open the revert PR above. The next merge to `main` applies whatever `main` holds and undoes the emergency apply.

### Rollback restores infrastructure, not data

A rollback puts resources back to their earlier definition. It doesn't bring back deleted data. The web bucket holds only build output, which every deploy uploads again. The user pool holds users, and a lost pool can't be restored, because Cognito can't export passwords. The data table holds every user's records, and the documents bucket every user's files. All three have deletion protection (the bucket through its `DenyBucketDeletion` statement) and `prevent_destroy`, and a revert must never replace any of them (see the rules above). The table has point-in-time recovery, as described below. The bucket keeps old versions of each document for 35 days.

### Restore data in the table

Use this when items were deleted or overwritten by mistake, for example by a bug or a wrong command. Point-in-time recovery (PITR) keeps 35 days, and the latest restorable time is about five minutes ago. A restore always creates a **new** table, and the live table stays in use while it runs. So the steps restore into a temporary table, copy back only what was lost, and then delete the temporary table. The live table keeps its name, so OpenTofu and the Lambdas need no change.

1. Find the restorable window:

   ```bash
   ENV=dev
   aws dynamodb describe-continuous-backups --table-name "cv-tailor-$ENV-data" --profile "cvt-$ENV" \
     --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
   ```

   Expected: `PointInTimeRecoveryStatus` is `ENABLED`, with `EarliestRestorableDateTime` and `LatestRestorableDateTime`.

2. Restore to a moment just before the damage, into a temporary table:

   ```bash
   AT=2026-10-03T09:00:00Z   # just before the damage, in UTC, inside the window from step 1
   RESTORED="cv-tailor-$ENV-data-restore-$(date -u +%Y%m%d%H%M)"
   aws dynamodb restore-table-to-point-in-time --profile "cvt-$ENV" \
     --source-table-name "cv-tailor-$ENV-data" --target-table-name "$RESTORED" \
     --restore-date-time "$AT" --billing-mode-override PAY_PER_REQUEST
   aws dynamodb wait table-exists --table-name "$RESTORED" --profile "cvt-$ENV"
   ```

   How long a restore takes depends on the table's size, and AWS gives no fixed time. The temporary table doesn't get the live table's TTL, PITR, tags, or alarms. That's fine, because it is deleted at the end.

3. Copy back one user's items. Check them first: `put-item` replaces the live item, so a change made after the restore time would be lost. For quota counters, copying back an old counter gives back quota that was already spent.

   ```bash
   SUB=<the user's sub>
   aws dynamodb query --table-name "$RESTORED" --profile "cvt-$ENV" --output json \
     --key-condition-expression 'PK = :pk' \
     --expression-attribute-values "{\":pk\":{\"S\":\"USER#$SUB\"}}" \
     | jq -c '.Items[]' > "restore-$SUB.jsonl"
   # Read restore-$SUB.jsonl, and remove any line that shouldn't be copied back. Then:
   while read -r item; do
     aws dynamodb put-item --table-name "cv-tailor-$ENV-data" --profile "cvt-$ENV" --item "$item"
   done < "restore-$SUB.jsonl"
   ```

   The file holds user data, so delete it when you're done.

4. Delete the temporary table and the file:

   ```bash
   aws dynamodb delete-table --table-name "$RESTORED" --profile "cvt-$ENV"
   rm "restore-$SUB.jsonl"
   ```

If the whole table was deleted (deletion protection makes this unlikely), DynamoDB keeps a system backup, `cv-tailor-<env>-data$DeletedTableBackup`, for 35 days. Restore it under the original name. OpenTofu finds a table by its name, so the next workload plan picks up the restored table. It doesn't copy TTL, PITR, deletion protection, or tags, and the plan turns those back on in place. Read that plan first: it must not replace the table.

## 7. Move from CDK (once, S3-15)

**Done on 2026-10-07.** Kept as a record, and as the order to follow for a similar move. The steps below include the fixes found while running them.

The one-time move from the CDK app to OpenTofu ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md) §10). Every resource CloudFormation manages is created again by OpenTofu, except the two hosted zones, which are imported, so their name servers don't change. `dev` holds only test data, and its users, documents, and table items are lost.

Run it from the `s3/15-opentofu` branch, after review and before the merge. Until the merge, freeze merges to `main`: a CI run in between would run `cdk deploy`.

### 7.1 Before you start

```bash
git switch s3/15-opentofu && git pull
pnpm install --frozen-lockfile
pnpm --filter @cv-tailor/web --filter @cv-tailor/api run build
aws sso login --sso-session org
for env in dev stag prod; do aws sts get-caller-identity --profile "cvt-$env" --query Account --output text; done
```

Record the IDs that the old stacks publish. Their SSM parameters are deleted with the stacks:

```bash
export DEV_POOL=$(aws ssm get-parameter --name /cv-tailor/auth/user-pool-id --profile cvt-dev --query Parameter.Value --output text)
export DEV_ZONE=$(aws route53 list-hosted-zones-by-name --dns-name dev.cv.ikiwii.com --max-items 1 --profile cvt-dev --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
export PROD_ZONE=$(aws route53 list-hosted-zones-by-name --dns-name cv.ikiwii.com --max-items 1 --profile cvt-prod --query 'HostedZones[0].Id' --output text | sed 's#/hostedzone/##')
echo "$DEV_POOL $DEV_ZONE $PROD_ZONE"
curl -s 'https://dns.google/resolve?name=dev.cv.ikiwii.com&type=NS' | jq -r '.Answer[].data'
```

Expected: a pool ID such as `us-east-1_…`, two zone IDs starting with `Z`, and the four `dev` name servers listed in `infra/modules/settings`.

A helper for the steps below. It turns off a stack's termination protection, deletes it, and waits:

```bash
delete_stack() { # <stack> <profile>
  aws cloudformation update-termination-protection --no-enable-termination-protection \
    --stack-name "$1" --profile "$2" >/dev/null
  aws cloudformation delete-stack --stack-name "$1" --profile "$2"
  aws cloudformation wait stack-delete-complete --stack-name "$1" --profile "$2"
}
```

### 7.2 Bootstrap all three accounts

```bash
for env in dev stag prod; do AWS_PROFILE="cvt-$env" infra/scripts/tofu.sh "$env" bootstrap create; done
```

Each one asks you to confirm its apply. Expected at the end of each: `The bootstrap state is now in s3://cv-tailor-tfstate-<account>/<env>/bootstrap.tfstate.`

### 7.3 Tear down the dev workload

Dependent stacks first. `dev` is down from here until step 7.6.

```bash
for stack in Api AuthDomain Web Auth KnowledgeBase Data; do delete_stack "dev-$stack" cvt-dev; done
```

The stacks keep (retain) the user pool, the data table, and the documents bucket. Delete them by hand, after turning off their protection:

```bash
P=(--profile cvt-dev)
# update-user-pool resets every setting it isn't given, and Cognito refuses a pool that keeps the
# old email until the new one is verified without auto-verifying email. So email goes along.
aws cognito-idp update-user-pool --user-pool-id "$DEV_POOL" --deletion-protection INACTIVE \
  --auto-verified-attributes email "${P[@]}"
aws cognito-idp delete-user-pool --user-pool-id "$DEV_POOL" "${P[@]}"

aws dynamodb update-table --table-name cv-tailor-dev-data --no-deletion-protection-enabled "${P[@]}" >/dev/null
aws dynamodb delete-table --table-name cv-tailor-dev-data "${P[@]}" >/dev/null

BUCKET=cv-tailor-dev-documents-$(aws sts get-caller-identity "${P[@]}" --query Account --output text)
aws s3api delete-bucket-policy --bucket "$BUCKET" "${P[@]}"   # removes DenyBucketDeletion
aws s3api list-object-versions --bucket "$BUCKET" "${P[@]}" --output json \
  --query '{Objects: [Versions[].{Key: Key, VersionId: VersionId}, DeleteMarkers[].{Key: Key, VersionId: VersionId}][]}' \
  > /tmp/versions.json
jq -e '.Objects | length > 0' /tmp/versions.json >/dev/null \
  && aws s3api delete-objects --bucket "$BUCKET" --delete file:///tmp/versions.json "${P[@]}" >/dev/null
aws s3api delete-bucket --bucket "$BUCKET" "${P[@]}"
rm /tmp/versions.json
```

`delete-objects` takes up to 1,000 versions per call, which is enough for `dev`'s test documents. Then delete the log groups CDK kept. Their names were generated, so they don't clash with the new ones, but they hold old logs:

```bash
aws logs describe-log-groups "${P[@]}" --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' \
  | grep -E '^(dev-|/aws/lambda/dev-)' | while read -r group; do aws logs delete-log-group --log-group-name "$group" "${P[@]}"; done
```

The Google client secret (`cv-tailor/google-client-secret`) stays: no stack managed it.

### 7.4 Recreate access, baseline, and the certificate

In each account, delete the old stacks, then apply the new ones: the budget first, then the CI role. The kill switch comes back with its committed value: `enabled` in `dev`, and `disabled` in `stag` and `prod`.

```bash
for env in dev stag prod; do
  for stack in access-GithubOidc baseline-Budget baseline-KillSwitch; do delete_stack "$env-$stack" "cvt-$env"; done
  AWS_PROFILE="cvt-$env" infra/scripts/tofu.sh "$env" baseline apply
  AWS_PROFILE="cvt-$env" infra/scripts/tofu.sh "$env" access apply
done
delete_stack dev-dns-Certificate cvt-dev
```

In each account, check the deploy role's trust and limits as in [step 3](#3-laptop-only-stacks-access-baseline-and-dns).

### 7.5 Import the hosted zones

Deleting the zone stacks keeps the zones (CDK retained them). The `prod` stack's `NS` records for `dev` go with it, so `dev.cv.ikiwii.com` doesn't resolve until the `prod` apply below.

```bash
delete_stack prod-dns-Zone cvt-prod
delete_stack dev-dns-Zone cvt-dev
AWS_PROFILE=cvt-prod infra/scripts/tofu.sh prod dns import module.zone.aws_route53_zone.this "$PROD_ZONE"
AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev dns import module.zone.aws_route53_zone.this "$DEV_ZONE"
AWS_PROFILE=cvt-prod infra/scripts/tofu.sh prod dns plan
```

Expected `prod` plan: the zone updated in place (its comment and tags only), and one `NS` record to create, for `dev.cv.ikiwii.com`. Nothing replaced or destroyed. Then:

```bash
AWS_PROFILE=cvt-prod infra/scripts/tofu.sh prod dns apply
curl -s 'https://dns.google/resolve?name=dev.cv.ikiwii.com&type=NS' | jq -r '.Answer[].data'
```

When the four `dev` name servers are back, plan and apply `dev`. Expected: the zone updated in place, and a new certificate, its validation record, and the wait for it to be issued:

```bash
AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev dns plan
AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev dns apply
```

The new certificate uses the same validation `CNAME` as the old one: ACM gives every certificate for the same domain in the same account the same record. CloudFormation left that record in the zone, and the apply takes it over (`allow_overwrite`), so ACM may issue the new certificate at once.

### 7.6 Apply the dev workload

```bash
export AWS_PROFILE=cvt-dev
infra/scripts/tofu.sh dev workload plan -out=tfplan
infra/scripts/tofu.sh dev workload apply tfplan
infra/scripts/deploy-web.sh dev
infra/scripts/tofu.sh dev workload plan
```

Expected: the last plan prints `No changes.` If it shows `connector_parameters` changing only in the order of its keys, the service returns them in another order (provider issue [#50065](https://github.com/hashicorp/terraform-provider-aws/issues/50065)). Check the stored value with `aws bedrock-agent get-data-source`, and write the JSON in that order as a literal string in `infra/modules/knowledge-base/main.tf` instead of `jsonencode`.

Then sign up again on `https://dev.cv.ikiwii.com`, and add yourself to the `admin` group ([users and admins](users-and-admins.md)).

### 7.7 Remove CDK's leftovers

In each account, delete the `CDKToolkit` stack. Its staging bucket and container repository are kept, so delete them too:

```bash
for env in dev stag prod; do
  ACCOUNT=$(aws sts get-caller-identity --profile "cvt-$env" --query Account --output text)
  delete_stack CDKToolkit "cvt-$env"
  STAGING="cdk-hnb659fds-assets-$ACCOUNT-us-east-1"
  aws s3api list-object-versions --bucket "$STAGING" --profile "cvt-$env" --output json \
    --query '{Objects: [Versions[].{Key: Key, VersionId: VersionId}, DeleteMarkers[].{Key: Key, VersionId: VersionId}][]}' \
    > /tmp/versions.json
  jq -e '.Objects | length > 0' /tmp/versions.json >/dev/null \
    && aws s3api delete-objects --bucket "$STAGING" --delete file:///tmp/versions.json --profile "cvt-$env" >/dev/null
  aws s3api delete-bucket --bucket "$STAGING" --profile "cvt-$env"
  aws ecr delete-repository --repository-name "cdk-hnb659fds-container-assets-$ACCOUNT-us-east-1" --force --profile "cvt-$env" 2>/dev/null || true
done
rm -f /tmp/versions.json
```

A staging bucket with more than 1,000 versions needs `delete-objects` again until the list is empty.

Then update the emergency-deny SCP from the management account. It no longer exempts the CloudFormation execution role:

```bash
EMERGENCY=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --profile org-mgmt \
  --query "Policies[?Name=='EmergencyDeny'].Id" --output text)
aws organizations update-policy --policy-id "$EMERGENCY" --profile org-mgmt \
  --content file://infra/org/scps/emergency-deny.json --query Policy.PolicySummary.Name --output text
```

### 7.8 Merge

Merge the PR. CI's first OpenTofu deploy plans and applies `dev` with `GithubDeployRole`. Expected: green, with `No changes.` in the plan, which shows that the role can read every workload resource. Then delete the secrets CI no longer reads: `gh secret delete CVT_STAG_ACCOUNT_ID --env dev`, and the same for `CVT_PROD_ACCOUNT_ID` and `CVT_ALERT_EMAIL`.

### 7.9 Check

```bash
for env in dev stag prod; do
  aws cloudformation list-stacks --profile "cvt-$env" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE --query 'StackSummaries[].StackName'
done
ACCOUNT=$(aws sts get-caller-identity --profile cvt-dev --query Account --output text)
aws s3 cp "s3://cv-tailor-tfstate-$ACCOUNT/dev/workload.tfstate" - --profile cvt-dev | grep -c client_secret
AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev workload plan -destroy 2>&1 | grep -c prevent_destroy
```

Expected: `[]` for every account (no CloudFormation stacks left), `0` (the state is ciphertext), and a count above `0` (the plan refuses to destroy the protected resources). Then run the live checks from S2-04 to S3-07: the site, managed login at `auth.dev.cv.ikiwii.com` with a password and with Google, `GET /me` with and without a token, and the document upload, list, and delete.

## Verify

- `AWS_PROFILE=cvt-dev infra/scripts/tofu.sh dev workload plan` prints `No changes.` on `main`.
- The latest `CI` run on `main` is green, including `deploy-dev / deploy`: `gh run list --workflow ci.yml --branch main --limit 1`.
- `https://dev.cv.ikiwii.com/` returns `200`, as in [step 1](#1-normal-deploy-ci).
- `infra/scripts/tofu.sh prod dns plan` (as `cvt-prod`) and `infra/scripts/tofu.sh dev dns plan` (as `cvt-dev`) print `No changes.` on `main`.

## If it fails

- `No valid credential sources found`, or `Unable to build encryption key data`: you aren't signed in, or `AWS_PROFILE` is wrong ([account access](account-access.md)).
- `CVT_<ENV>_ACCOUNT_ID must be a 12-digit account ID`: `infra/.env` is missing or incomplete.
- `AWS account ID not allowed`: `AWS_PROFILE` belongs to another environment's account. Set it to `cvt-<env>` for the environment you named.
- `Usage: …/tofu.sh`: the environment or stack name is wrong. The stacks are `bootstrap`, `access`, `baseline`, `dns`, and `workload`.
- `Resource instance cannot be destroyed`, naming `prevent_destroy`: the plan would replace or destroy a protected resource. Don't remove the guard. Find which change forces a replacement (the plan marks it `# forces replacement`), and change the code so it doesn't.
- `Error: Inconsistent dependency lock file`: a provider changed without its lock file. Run `tofu providers lock -platform=linux_amd64 -platform=linux_arm64` in that stack's folder, and commit the lock file.

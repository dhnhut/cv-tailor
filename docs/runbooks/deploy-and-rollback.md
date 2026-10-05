# Deploy and Rollback

How CV Tailor's infrastructure gets to AWS, how to preview and recover a deploy, and how to set up a new account. The design is in [ADR-0004](../adr/0004-accounts-and-access.md) §4–5.

## When to use

- Checking that a merge reached `dev`.
- Previewing what a change will do before merging it.
- Changing the GitHub OIDC role, a budget, or DNS (laptop-only stages).
- Setting up a new environment account.
- A deploy failed, or a deploy succeeded but broke something.

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. `infra/.env` exists and has the three account IDs and the alert email ([account access, step 2.4](account-access.md#2-new-machine-setup)). The CDK app builds every stage, so it needs all four values even when you work on one environment.
3. Dependencies are installed: `pnpm install`.
4. The build output exists: `pnpm --filter @cv-tailor/web --filter @cv-tailor/api run build`. The CDK app uploads `apps/web/dist`, `apps/api/dist/pre-sign-up`, and `apps/api/dist/me`, so `cdk synth`, `cdk diff`, and `cdk deploy` fail with `CannotFindAsset` without them. Build again after changing either app.
5. For CI tasks, the GitHub CLI is signed in: `gh auth status`.

## What deploys where

The CDK app has three stages for each environment, plus a DNS stage for `dev` and `prod`. Each stage is deployed separately.

| Stage            | Stacks (CloudFormation name)                                                                                                                                                                                                                                                                         | Deployed by                               | When                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `<env>`          | The workload: `<env>-Web`, the web app on S3 and CloudFront (S2-04). `<env>-Auth`, the user pool and the web app's client. `<env>-AuthDomain`, the sign-in pages at `auth.<host>` (S2-05). `<env>-Data`, the data table `cv-tailor-<env>-data` (S2-08). `<env>-Api`, the API at `api.<host>` (S2-09) | CI (`dev` only, on every merge to `main`) | Every merge                                               |
| `<env>-access`   | `<env>-access-GithubOidc`: the OIDC provider and `GithubDeployRole`                                                                                                                                                                                                                                  | Laptop only                               | Only when the CI trust changes                            |
| `<env>-baseline` | `<env>-baseline-Budget`: the monthly budget. `<env>-baseline-KillSwitch`: the kill switch parameter `/cv-tailor/ai-calls` (S2-11)                                                                                                                                                                    | Laptop only                               | Only when the budget or the kill switch parameter changes |
| `<env>-dns`      | `<env>-dns-Zone`: the hosted zone and its delegation records. `<env>-dns-Certificate` (`dev` only today): the certificate for `<host>` and `*.<host>` ([ADR-0008](../adr/0008-domain-and-dns.md))                                                                                                    | Laptop only                               | Only when a zone, delegation, or certificate changes      |

Rules:

- **Never deploy with `'**'`.** Always name one stage, for example `'dev/*'`. CI must never be able to change the role it signs in with, the budget that watches it, the kill switch, or DNS (ADR-0004 §4, ADR-0008).
- `stag` and `prod` have no workload yet. `prod` has its `-dns` stage; `stag` gets one with the release path (slice R).
- The workload reads the zone ID and certificate ARN from SSM, so an environment's `-dns` stage, with its certificate, must be deployed before its first workload deploy.
- An environment with a Google client ID in `infra/config/environments.ts` needs its Google client secret in Secrets Manager before the deploy that adds Google sign-in. CloudFormation reads it during that deploy ([Google sign-in runbook](google-sign-in.md#13-store-the-secret)).
- `CDKToolkit`, `<env>-access-GithubOidc`, `<env>-baseline-Budget`, `<env>-baseline-KillSwitch`, `<env>-dns-Zone`, `<env>-dns-Certificate`, `<env>-Auth`, and `<env>-Data` have termination protection. Deleting one needs `aws cloudformation update-termination-protection --no-enable-termination-protection` first, and should almost never happen. A deleted zone stack leaves its hosted zone in place (retained).
- **Never replace the user pool.** If `cdk diff` shows the `AWS::Cognito::UserPool` as replaced, don't merge. CloudFormation would create a new, empty pool, and every user would get a new `sub`. Deletion protection and the retain policy keep the old pool, but nothing would point at it any more.
- **Never replace the data table.** If `cdk diff` shows the `AWS::DynamoDB::GlobalTable` in `<env>-Data` as replaced, or its type changing to `AWS::DynamoDB::Table`, don't merge. The table's fixed name makes a replacement fail, but a type change can delete the table ([ADR-0006](../adr/0006-data-store.md)).
- **A baseline deploy can reset the kill switch.** If `cdk diff` for `<env>-baseline/*` lists the `AWS::SSM::Parameter`, the deploy writes the committed initial value over the switch's current value ([kill switch runbook, step 5](kill-switch.md#5-deploy-the-baseline-stage-without-resetting-the-switch)).

## 1. Normal deploy (CI)

1. Merge the PR into `main`. The `CI` workflow runs `check`, then `deploy-dev`, which runs `cdk deploy 'dev/*'` with `GithubDeployRole`.
2. Watch it:

   ```bash
   gh run list --workflow ci.yml --branch main --limit 3
   gh run watch <run-id> --exit-status
   ```

3. Check the stack in AWS:

   ```bash
   aws cloudformation describe-stacks --stack-name dev-Web --profile cvt-dev \
     --query 'Stacks[0].StackStatus' --output text
   curl -sI https://dev.cv.ikiwii.com/ | head -1
   ```

   Expected: `UPDATE_COMPLETE` or `CREATE_COMPLETE`, and `HTTP/2 200`.

## 2. Preview a change

From your branch, before you open or merge the PR:

```bash
pnpm --filter infra exec cdk diff 'dev/*' --profile cvt-dev
```

`There were no differences` means the merge won't change `dev`. Read every `[-]` (removed) and `[~]` (replaced) resource carefully. A replaced resource with data in it loses the data.

## 3. Laptop-only deploys (`-access`, `-baseline`, and `-dns`)

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

### DNS zones and certificates (`-dns`)

The zone stack writes the hosted zone ID to SSM (`/cv-tailor/dns/zone-id`), and the certificate stack writes the certificate ARN (`/cv-tailor/dns/certificate-arn`). Other stacks read them at deploy time, so no stack depends on another through a CloudFormation export.

First setup, in this order. Each step waits for the one before it ([ADR-0008](../adr/0008-domain-and-dns.md)).

1. Create the `prod` zone:

   ```bash
   pnpm --filter infra exec cdk deploy 'prod-dns/Zone' --profile cvt-prod
   ```

   The stack prints its four name servers (the `NameServers` output). At the registrar of `ikiwii.com`, add four `NS` records for the host `cv`, one per name server.

2. Create the `dev` zone:

   ```bash
   pnpm --filter infra exec cdk deploy 'dev-dns/Zone' --profile cvt-dev
   ```

3. Delegate `dev.cv.ikiwii.com`. Copy the four name servers from step 2 into the `dev.cv.ikiwii.com` entry of `DNS.prod.delegations` in `infra/config/environments.ts`, commit, and deploy the `prod` zone again. It adds the `NS` records for `dev`:

   ```bash
   pnpm --filter infra exec cdk deploy 'prod-dns/Zone' --profile cvt-prod
   ```

4. When `dig NS dev.cv.ikiwii.com +short` returns the four name servers from step 2, create the certificate. ACM checks its validation record through public DNS, so it can't be issued before the delegation works. The deploy waits until the certificate is issued, usually a few minutes:

   ```bash
   pnpm --filter infra exec cdk deploy 'dev-dns/Certificate' --profile cvt-dev
   ```

Check:

```bash
dig NS cv.ikiwii.com +short
dig NS dev.cv.ikiwii.com +short
aws acm list-certificates --profile cvt-dev \
  --query "CertificateSummaryList[?DomainName=='dev.cv.ikiwii.com'].Status" --output text
```

Expected: the four name servers of each zone, and `ISSUED`. Where `dig` isn't installed (the devcontainer), ask a public resolver over HTTPS instead: `curl -s 'https://dns.google/resolve?name=dev.cv.ikiwii.com&type=NS'`.

A new zone gets new name servers, so a zone that is deleted and created again breaks the delegation above it. Repeat step 1 (registrar) or step 3 (parent zone) for that zone.

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
   aws cloudformation describe-stack-events --stack-name dev-Web --profile cvt-dev --max-items 20 \
     --query 'StackEvents[].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' --output table
   ```

   If the job failed before CloudFormation started (install, credentials, or synth errors), read the job log instead: `gh run view <run-id> --log-failed`.

2. Act on the stack status:

   | Stack status                                  | What to do                                                                                                                                                                                                                                                                 |
   | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `UPDATE_ROLLBACK_COMPLETE`                    | Back on the previous version. If the error was transient (throttling, a timeout), rerun the job: `gh run rerun <run-id> --failed`. Otherwise fix the code in a new PR.                                                                                                     |
   | `ROLLBACK_COMPLETE` (the first create failed) | The stack can't be updated. Delete it, then rerun the job: `aws cloudformation delete-stack --stack-name dev-Web --profile cvt-dev`.                                                                                                                                       |
   | `UPDATE_ROLLBACK_FAILED`                      | CloudFormation couldn't undo a resource. Fix the cause shown in the events, then `aws cloudformation continue-update-rollback --stack-name dev-Web --profile cvt-dev`. Skipping resources with `--resources-to-skip` is a last resort, because it leaves them out of sync. |
   | `*_IN_PROGRESS`                               | Wait. The workflow never cancels a running deploy (`cancel-in-progress: false`).                                                                                                                                                                                           |

3. CI-only errors:

   | Error in the job log                                                                                                            | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `Not authorized to perform sts:AssumeRoleWithWebIdentity`                                                                       | The job's Environment or branch doesn't match the role trust. Check that the job runs in the `dev` Environment from `main`, and check the trust as in [step 3](#3-laptop-only-deploys--access--baseline-and--dns).                                                                                                                                                                                                                                                                                                                                                                                           |
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

A rollback puts resources back to their earlier definition. It doesn't bring back deleted data. The web bucket holds only build output, which every deploy uploads again. The user pool (`<env>-Auth`) holds users, and a lost pool can't be restored, because Cognito can't export passwords. The data table (`<env>-Data`) holds every user's records. Both have deletion protection, a retain policy, termination protection, and a fixed logical ID, and a revert must never replace either (see the rules above). The table also has point-in-time recovery, so its data can be restored, as described below. When S3 buckets that hold user data are added, they need a retain removal policy and versioning, and a restore section of their own.

### Restore data in the table

Use this when items were deleted or overwritten by mistake, for example by a bug or a wrong command. Point-in-time recovery (PITR) keeps 35 days, and the latest restorable time is about five minutes ago. A restore always creates a **new** table, and the live table stays in use while it runs. So the steps restore into a temporary table, copy back only what was lost, and then delete the temporary table. The live table keeps its name, so CDK and the Lambdas need no change.

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

If the whole table was deleted (deletion protection makes this unlikely), DynamoDB keeps a system backup, `cv-tailor-<env>-data$DeletedTableBackup`, for 35 days. Restoring it under the original name gives back the data, but CloudFormation still thinks it manages the deleted table. Bringing the restored table back into `<env>-Data` needs a resource import. Stop and plan that step before changing anything else.

## Verify

- `pnpm --filter infra exec cdk diff 'dev/*' --profile cvt-dev` prints `There were no differences` on `main`.
- The latest `CI` run on `main` is green, including `deploy-dev / deploy`: `gh run list --workflow ci.yml --branch main --limit 1`.
- `describe-stacks` shows `dev-Web`, `dev-Auth`, `dev-AuthDomain`, and `dev-Data` as complete, and `https://dev.cv.ikiwii.com/` returns `200`, as in [step 1](#1-normal-deploy-ci).
- `pnpm --filter infra exec cdk diff 'prod-dns/*' --profile cvt-prod` and `pnpm --filter infra exec cdk diff 'dev-dns/*' --profile cvt-dev` print `There were no differences` on `main`.

## If it fails

- `Need to perform AWS calls for account …, but no credentials have been configured`: you aren't signed in, or the profile is wrong ([account access](account-access.md)).
- `Missing or invalid settings: CVT_…` on the laptop: `infra/.env` is missing or incomplete.
- `No stacks match the name(s)`: the selector has no `/*`, or the stage name is wrong. List them with `pnpm --filter infra exec cdk list '**'`.
- `This CDK deployment requires bootstrap stack version …`: bootstrap the account again, as in [step 4.2](#4-set-up-a-new-environment-account).

# Budget Alarm Response

What to do when an AWS Budgets alert arrives. Each environment account has one monthly cost budget (S1-09, `AGENTS.md` §8).

## When to use

- A budget alert email arrives.
- The bill or a dashboard shows spend you didn't expect.
- You suspect leaked credentials, even without an alert.

## Before you start

- Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
- Set the environment named in the alert. All commands below use these two variables:

  ```bash
  ENV=dev   # dev, stag, or prod: from the budget name cv-tailor-<env>-monthly
  ACCOUNT=$(aws organizations list-accounts --profile org-mgmt \
    --query "Accounts[?Name=='cv-tailor-$ENV'].Id" --output text)
  ```

## 1. Read the alert

| Item        | Value                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Budget name | `cv-tailor-<env>-monthly`. The `<env>` is the account.                                                         |
| Amount      | USD 5 (`dev`), 5 (`stag`), 10 (`prod`) per month, from `infra/config/environments.ts`                          |
| Alerts      | Actual spend above 25%, 50%, 80%, and 100%, and forecast spend above 100%                                      |
| Spend type  | Before credits (`IncludeCredit: false`), so credits never hide real usage                                      |
| Delay       | Budgets updates a few times a day, and cost data can be up to 24 hours late. Real spend may already be higher. |

## 2. Check the current spend

```bash
aws budgets describe-budget --account-id "$ACCOUNT" --budget-name "cv-tailor-$ENV-monthly" \
  --profile "cvt-$ENV" --query 'Budget.CalculatedSpend' --output json
```

Use `--profile cvt-prod-ro` for `prod`.

## 3. Find the cost driver

1. **Cost by service, this month.** Run from `org-mgmt`, which sees every account. Each Cost Explorer API request costs USD 0.01. Credits are filtered out to match the budget.

   ```bash
   aws ce get-cost-and-usage --profile org-mgmt \
     --time-period "Start=$(date -u +%Y-%m-01),End=$(date -u -d tomorrow +%F)" \
     --granularity MONTHLY --metrics UnblendedCost \
     --filter "{\"And\":[{\"Dimensions\":{\"Key\":\"LINKED_ACCOUNT\",\"Values\":[\"$ACCOUNT\"]}},{\"Not\":{\"Dimensions\":{\"Key\":\"RECORD_TYPE\",\"Values\":[\"Credit\"]}}}]}" \
     --group-by Type=DIMENSION,Key=SERVICE \
     --query 'ResultsByTime[].Groups[].[Keys[0],Metrics.UnblendedCost.Amount]' --output text
   ```

   Change `--granularity MONTHLY` to `DAILY` to see when the cost started.

2. **Bedrock (near real time).** Cost Explorer is late. Token counts in CloudWatch are not:

   ```bash
   aws cloudwatch list-metrics --namespace AWS/Bedrock --metric-name InputTokenCount \
     --profile "cvt-$ENV" --query 'Metrics[].Dimensions[].Value' --output text
   aws cloudwatch get-metric-statistics --namespace AWS/Bedrock --metric-name InputTokenCount \
     --dimensions Name=ModelId,Value=<model-id-from-the-list> \
     --start-time "$(date -u -d '-24 hours' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
     --period 3600 --statistics Sum --profile "cvt-$ENV" --output table
   ```

   Repeat with `OutputTokenCount`. Output tokens cost several times more than input tokens.

3. **Who did it.** Recent API calls in the account (CloudTrail event history, last 90 days, `us-east-1`):

   ```bash
   aws cloudtrail lookup-events --profile "cvt-$ENV" --max-results 50 \
     --start-time "$(date -u -d '-24 hours' +%FT%TZ)" \
     --query 'Events[].[EventTime,EventName,Username]' --output table
   ```

   Calls from a principal you don't recognise, or from an SSO session that isn't yours, mean leaked credentials: go straight to [5. Emergency stop](#5-emergency-stop). The full history for every account is in the organization trail bucket in `log-archive` ([`infra/org/README.md`](../../infra/org/README.md)).

## 4. Respond by level

| Alert                                                                 | Response                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual 25% or 50%                                                     | Find the driver (step 3). If it's expected, note it and continue. If not, treat it like 80%.                                                                                                                                                                                                                                                                                                                                              |
| Actual 80%, or forecast 100%                                          | If the driver is Bedrock, turn the [kill switch](kill-switch.md#2-turn-ai-calls-off) off first: it stops AI calls within 30 seconds and keeps the app running. Otherwise, find the driver and remove it: stop or delete the resource, or destroy the part of the workload that drives it (`infra/scripts/tofu.sh <env> workload destroy -target=module.api`, or `module.web`). CI recreates it on the next merge, so fix the cause first. |
| Actual 100%, a driver you can't find, or suspected leaked credentials | [5. Emergency stop](#5-emergency-stop).                                                                                                                                                                                                                                                                                                                                                                                                   |

## 5. Emergency stop

The `EmergencyDeny` SCP ([`infra/org/scps/emergency-deny.json`](../../infra/org/scps/emergency-deny.json)) denies every action in the account, for every principal except:

- the human SSO roles (`AdministratorAccess` and `ReadOnlyAccess`), so you can still investigate, and clean up with OpenTofu from your laptop.

It stops app roles, Bedrock calls from the app, CI deploys, and any leaked key at once. It exists in the Organization but is attached to nothing until an emergency.

1. Attach it to the account:

   ```bash
   EMERGENCY=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --profile org-mgmt \
     --query "Policies[?Name=='EmergencyDeny'].Id" --output text)
   aws organizations attach-policy --policy-id "$EMERGENCY" --target-id "$ACCOUNT" --profile org-mgmt
   ```

2. Check that it works. SCP changes can take a few minutes to apply. The IAM policy simulator includes the Organization's SCPs in its answer (not yet tested in a drill):

   ```bash
   # GithubDeployRole is not exempt: expect false
   aws iam simulate-principal-policy --profile "cvt-$ENV" \
     --policy-source-arn "arn:aws:iam::$ACCOUNT:role/GithubDeployRole" --action-names lambda:ListFunctions \
     --query 'EvaluationResults[0].OrganizationsDecisionDetail.AllowedByOrganizations'
   # As you (exempt): expect a normal result
   aws dynamodb list-tables --profile "cvt-$ENV"
   ```

3. Clean up as the SSO admin, from your laptop. Destroy the parts of the workload that cost money with OpenTofu ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md)), which runs as you, so the SCP doesn't stop it. `-target` destroys only that module and what depends on it. The data table, the user pool, and the documents bucket can't be destroyed this way (`prevent_destroy`).

   Every workload plan, a destroy included, zips the Lambda bundles, so build them first: `pnpm --filter @cv-tailor/api run build`.

   First the API (S2-09). It holds no data. It goes offline, and `api.<host>` stops resolving:

   ```bash
   infra/scripts/tofu.sh "$ENV" workload destroy -target=module.api
   ```

   Then the web app. The sign-in domain depends on it, so it goes too. The site bucket holds only build output, and OpenTofu empties it first (`force_destroy`):

   ```bash
   infra/scripts/tofu.sh "$ENV" workload destroy -target=module.web
   ```

4. If credentials leaked, remove them: revoke the SSO session (Identity Center → Users → Active sessions) or the leaked role session, and find how they leaked before going on.
5. Detach the policy:

   ```bash
   aws organizations detach-policy --policy-id "$EMERGENCY" --target-id "$ACCOUNT" --profile org-mgmt
   ```

6. Restore the workload. Wait a few minutes, then rerun the last deploy (`gh run rerun <run-id>`) or merge the fix, as in the [deploy runbook](deploy-and-rollback.md#1-normal-deploy-ci). CI applies the whole workload stack again, which recreates what step 3 destroyed.
7. If the charges came from abuse or leaked credentials, open a case with AWS Support (Billing) and ask for a review of the charges.

While the policy is attached, CI deploys to that account fail. This is expected. The OIDC sign-in step still succeeds; the job fails at the first AWS call OpenTofu makes, which reads the encrypted state (`kms:GenerateDataKey` or `s3:GetObject`), with an explicit deny in a service control policy. The 2026-10-01 drill checked this with CDK; the OpenTofu message is not yet seen in a drill. CloudTrail shows the denied call either way.

## 6. Afterwards

- Record what happened, the cause, and the fix in the current sprint review.
- If a guardrail was missing (for example, a quota or a lower max-tokens limit), add it to the backlog.

## Verify

- Spend has stopped growing: run [step 3.1](#3-find-the-cost-driver) with `--granularity DAILY` on the next day.
- `EmergencyDeny` is not attached anywhere once the incident is over:

  ```bash
  aws organizations list-targets-for-policy --policy-id "$EMERGENCY" --profile org-mgmt --query 'Targets'
  ```

  Expected: `[]`.

## If it fails

- `AccessDeniedException` from Cost Explorer: the profile isn't `org-mgmt`, or Cost Explorer has never been opened in the management account console (it must be turned on once there).
- `EMERGENCY` is empty: the policy was never created. Create it as in [`infra/org/README.md`](../../infra/org/README.md) step 4.
- You are locked out after attaching the policy: SCPs never apply to the management account, so detach it with `org-mgmt` (step 5.5).

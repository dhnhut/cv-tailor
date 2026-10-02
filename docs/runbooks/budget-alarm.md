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

| Alert                                                                 | Response                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual 25% or 50%                                                     | Find the driver (step 3). If it's expected, note it and continue. If not, treat it like 80%.                                                                                                                                        |
| Actual 80%, or forecast 100%                                          | Find the driver and remove it: stop or delete the resource, or delete the workload stack (`aws cloudformation delete-stack --stack-name <env>-Web --profile cvt-<env>`). CI recreates it on the next merge, so fix the cause first. |
| Actual 100%, a driver you can't find, or suspected leaked credentials | [5. Emergency stop](#5-emergency-stop).                                                                                                                                                                                             |

## 5. Emergency stop

The `EmergencyDeny` SCP ([`infra/org/scps/emergency-deny.json`](../../infra/org/scps/emergency-deny.json)) denies every action in the account, for every principal except:

- the human SSO roles (`AdministratorAccess` and `ReadOnlyAccess`), so you can still investigate and clean up, and
- the CDK CloudFormation execution role, so `delete-stack` still works.

It stops app roles, Bedrock calls from the app, CI deploys, and any leaked key at once. It exists in the Organization but is attached to nothing until an emergency.

1. Attach it to the account:

   ```bash
   EMERGENCY=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --profile org-mgmt \
     --query "Policies[?Name=='EmergencyDeny'].Id" --output text)
   aws organizations attach-policy --policy-id "$EMERGENCY" --target-id "$ACCOUNT" --profile org-mgmt
   ```

2. Check that it works. SCP changes can take a few minutes to apply.

   ```bash
   # As a non-exempt principal (the CDK lookup role): expect "explicit deny in a service control policy"
   (
     unset AWS_PROFILE
     eval "$(aws sts assume-role --profile "cvt-$ENV" --role-session-name emergency-check \
       --role-arn "arn:aws:iam::$ACCOUNT:role/cdk-hnb659fds-lookup-role-$ACCOUNT-us-east-1" \
       --query 'Credentials' --output json \
       | jq -r '"export AWS_ACCESS_KEY_ID=\(.AccessKeyId) AWS_SECRET_ACCESS_KEY=\(.SecretAccessKey) AWS_SESSION_TOKEN=\(.SessionToken)"')"
     aws dynamodb list-tables --region us-east-1
   )
   # As you (exempt): expect a normal result
   aws dynamodb list-tables --profile "cvt-$ENV"
   ```

3. Clean up as the SSO admin. Delete the resources that cost money. To remove a whole CDK stack, use CloudFormation directly. `cdk destroy` doesn't work while the SCP is attached, because the CDK deploy role is denied.

   ```bash
   aws cloudformation delete-stack --stack-name "$ENV-Web" --profile "cvt-$ENV"
   aws cloudformation wait stack-delete-complete --stack-name "$ENV-Web" --profile "cvt-$ENV"
   ```

   Expected to fail while `EmergencyDeny` is attached (not yet tested in a drill). A CDK Lambda empties the web bucket before CloudFormation deletes it, and that Lambda's role isn't exempt from the SCP. The stack then ends in `DELETE_FAILED`. Empty the bucket yourself, then delete the stack again without that step. CloudFormation then deletes the empty bucket itself:

   ```bash
   BUCKET=$(aws cloudformation describe-stack-resources --stack-name "$ENV-Web" --profile "cvt-$ENV" \
     --query "StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId" --output text)
   AUTO_DELETE=$(aws cloudformation describe-stack-resources --stack-name "$ENV-Web" --profile "cvt-$ENV" \
     --query "StackResources[?ResourceType=='Custom::S3AutoDeleteObjects'].LogicalResourceId" --output text)
   aws s3 rm "s3://$BUCKET" --recursive --profile "cvt-$ENV"
   aws cloudformation delete-stack --stack-name "$ENV-Web" --retain-resources "$AUTO_DELETE" --profile "cvt-$ENV"
   aws cloudformation wait stack-delete-complete --stack-name "$ENV-Web" --profile "cvt-$ENV"
   ```

4. If credentials leaked, remove them: revoke the SSO session (Identity Center → Users → Active sessions) or the leaked role session, and find how they leaked before going on.
5. Detach the policy:

   ```bash
   aws organizations detach-policy --policy-id "$EMERGENCY" --target-id "$ACCOUNT" --profile org-mgmt
   ```

6. Restore the workload. Wait a few minutes, then rerun the last deploy (`gh run rerun <run-id>`) or merge the fix, as in the [deploy runbook](deploy-and-rollback.md#1-normal-deploy-ci).
7. If the charges came from abuse or leaked credentials, open a case with AWS Support (Billing) and ask for a review of the charges.

While the policy is attached, CI deploys to that account fail. This is expected. The OIDC sign-in step still succeeds; the job fails at `cdk deploy` with `BootstrapVersionSsmConfirmationFailed … ssm:GetParameter … no identity-based policy allows`. That message hides the cause. CloudTrail shows the real one: `GithubDeployRole` was denied `sts:AssumeRole` on the CDK deploy role `with an explicit deny in a service control policy` (checked in the 2026-10-01 drill).

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

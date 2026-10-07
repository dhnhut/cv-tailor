# Organization guardrails

Service control policies (SCPs) and the organization CloudTrail settings from [ADR-0004](../../docs/adr/0004-accounts-and-access.md) §6–7 (sprint item S1-05).

These are applied by hand from the management account, not by OpenTofu. The files here are the source of truth. When a policy changes, edit the file here first, then apply it with the commands below. `infra/test/org-policies.test.ts` checks the files in CI.

| File                            | Applied to                      | Purpose                                                                                                           |
| ------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `scps/baseline.json`            | Root (every member account)     | Deny leaving the Organization or closing the account, region deny, Bedrock inference limit, CloudTrail protection |
| `scps/log-protection.json`      | `Security` OU                   | Deny deleting or loosening the trail bucket (`org-trail-logs-*`)                                                  |
| `scps/emergency-deny.json`      | Nothing (created, not attached) | Emergency stop for one account: deny everything except the SSO roles                                              |
| `cloudtrail/bucket-policy.json` | Trail bucket in `log-archive`   | Template. Only the CloudTrail service, for the `org-trail` trail, may write. TLS only.                            |
| `cloudtrail/lifecycle.json`     | Trail bucket in `log-archive`   | Expire logs after 90 days                                                                                         |

## Baseline SCP

| Statement                                                            | What it does                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DenyLeaveOrgAndCloseAccount`                                        | Accounts are closed only from the management account, where SCPs don't apply.                                                                                                                                                                                     |
| `DenyOutsideAllowedRegions`                                          | Denies every action outside `us-east-1` ([ADR-0002](../../docs/adr/0002-aws-region.md)), except for global services and Bedrock inference.                                                                                                                        |
| `DenyBedrockInferenceOutsideAllowedRegionsExceptUsAndGlobalProfiles` | Denies Bedrock inference outside `us-east-1` unless the request uses a `us.` or `global.` inference profile. Both are called in `us-east-1`; a `us.` profile can run the request in other US regions, and a `global.` profile in any supported commercial region. |
| `ProtectCloudTrail`                                                  | Denies stopping, deleting, changing, or filtering any trail.                                                                                                                                                                                                      |

**Where the lists come from.** The global services `NotAction` list and the Bedrock pattern are copied from the AWS example [`Deny-access-to-AWS-based-on-the-requested-AWS-region-with-Bedrock-CRIS.json`](https://github.com/aws-samples/service-control-policy-examples/blob/088df0b0812c55bb0b90824c155776dfdf690404/Region-controls/Deny-access-to-AWS-based-on-the-requested-AWS-region-with-Bedrock-CRIS.json) (commit `088df0b`, 2026-09-23). One change from the example: it has no privileged-role exemption. Break-glass is the management account, where SCPs never apply. Check the example for updates when a new global service starts being used.

**Why the Bedrock pattern needs no region list.** The Bedrock statement matches the `us.*` and `global.*` inference profile ARNs, not a list of destination regions. It keeps working when AWS changes a profile's routing, and a direct call to a model in another region is still denied.

**How a `global.` call passes.** Bedrock authorizes a `global.` call three times: the profile in the source region, the model in the source region, and a region-less model ARN (`arn:aws:bedrock:::foundation-model/…`) for which `aws:RequestedRegion` is `unspecified` ([AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html)). The last check carries `bedrock:InferenceProfileArn`, so the `global.*` pattern exempts it. AWS's other option, adding `unspecified` to the allowed regions, is not used, because it would open the region-less case for every service. The first check carries the source region but no profile ARN, so a call must still start in `us-east-1`. `global.` is the project default for models ([ADR-0002](../../docs/adr/0002-aws-region.md)); the AWS example above covers geographic profiles only, so this pattern comes from the Bedrock documentation.

## Placeholders

The SCPs contain no IDs and are applied as committed. The bucket policy is a template with three placeholders, filled at apply time so that the IDs stay out of the repository:

```bash
export ORG_ID=o-xxxxxxxxxx              # aws organizations describe-organization --query Organization.Id
export MGMT_ACCOUNT_ID=111111111111     # aws sts get-caller-identity --profile org-mgmt
export LOG_ARCHIVE_ACCOUNT_ID=222222222222
export BUCKET=org-trail-logs-$LOG_ARCHIVE_ACCOUNT_ID
OUT=$(mktemp -d)
envsubst '${ORG_ID} ${MGMT_ACCOUNT_ID} ${LOG_ARCHIVE_ACCOUNT_ID}' \
  < infra/org/cloudtrail/bucket-policy.json > "$OUT/bucket-policy.json"
```

## Apply

Run from the repository root, in the same shell as the exports above. Log in first with `aws sso login --profile org-mgmt` and `aws sso login --profile org-log-archive`.

### 1. Trail bucket (`log-archive` account)

```bash
P=(--profile org-log-archive --region us-east-1)
aws s3api create-bucket --bucket "$BUCKET" "${P[@]}"
aws s3api put-public-access-block --bucket "$BUCKET" "${P[@]}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" "${P[@]}" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-encryption --bucket "$BUCKET" "${P[@]}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" "${P[@]}" \
  --lifecycle-configuration file://infra/org/cloudtrail/lifecycle.json
aws s3api put-bucket-policy --bucket "$BUCKET" "${P[@]}" --policy "file://$OUT/bucket-policy.json"
```

### 2. Organization trail (management account)

Check for existing trails first. The first copy of management events in an account is free, but a second trail that logs them is charged.

```bash
M=(--profile org-mgmt --region us-east-1)
aws cloudtrail describe-trails "${M[@]}"
aws organizations enable-aws-service-access --service-principal cloudtrail.amazonaws.com --profile org-mgmt
aws cloudtrail create-trail --name org-trail --s3-bucket-name "$BUCKET" "${M[@]}" \
  --is-organization-trail --is-multi-region-trail --include-global-service-events --enable-log-file-validation
aws cloudtrail start-logging --name org-trail "${M[@]}"
```

### 3. SCPs (management account)

A new SCP goes to `NonProd` first, is verified in `cvt-dev`, and only then goes to its final target.

```bash
ROOT_ID=$(aws organizations list-roots --query 'Roots[0].Id' --output text --profile org-mgmt)
OU() { aws organizations list-organizational-units-for-parent --parent-id "$1" --profile org-mgmt \
  --query "OrganizationalUnits[?Name=='$2'].Id" --output text; }
WORKLOADS=$(OU "$ROOT_ID" Workloads); NONPROD=$(OU "$WORKLOADS" NonProd); SECURITY=$(OU "$ROOT_ID" Security)

create() { aws organizations create-policy --type SERVICE_CONTROL_POLICY --profile org-mgmt \
  --name "$1" --description "$2" --content "$(jq -c . "$3")" --query 'Policy.PolicySummary.Id' --output text; }
BASELINE=$(create Baseline "ADR-0004 baseline guardrails" infra/org/scps/baseline.json)
LOGPROT=$(create LogProtection "ADR-0004 org trail bucket protection" infra/org/scps/log-protection.json)

# a. NonProd first, then run the checks below in cvt-dev
aws organizations attach-policy --policy-id "$BASELINE" --target-id "$NONPROD" --profile org-mgmt

# b. Root, then remove the NonProd attachment and the old policy it replaces
aws organizations attach-policy --policy-id "$BASELINE" --target-id "$ROOT_ID" --profile org-mgmt
aws organizations detach-policy --policy-id "$BASELINE" --target-id "$NONPROD" --profile org-mgmt
OLD=$(aws organizations list-policies --filter SERVICE_CONTROL_POLICY --profile org-mgmt \
  --query "Policies[?Name=='DenyLeaveAndCloseAccount'].Id" --output text)
aws organizations detach-policy --policy-id "$OLD" --target-id "$ROOT_ID" --profile org-mgmt
aws organizations delete-policy --policy-id "$OLD" --profile org-mgmt

# c. Log protection, after the trail delivers logs
aws organizations attach-policy --policy-id "$LOGPROT" --target-id "$SECURITY" --profile org-mgmt
```

### 4. Emergency deny (create only)

Created once and left **unattached**. It is attached to a single account only in an emergency, following the [budget alarm runbook](../../docs/runbooks/budget-alarm.md#5-emergency-stop).

```bash
EMERGENCY=$(create EmergencyDeny "ADR-0004 emergency stop for one account" infra/org/scps/emergency-deny.json)
aws organizations list-targets-for-policy --policy-id "$EMERGENCY" --profile org-mgmt   # expect no targets
```

The exemptions match the role ARNs by path. Before relying on the policy, check that the SSO roles have no region segment in their path:

```bash
aws iam list-roles --path-prefix /aws-reserved/sso.amazonaws.com/ --query 'Roles[].Arn' --output text --profile cvt-dev
```

Every ARN must look like `…:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_<permission set>_<suffix>`.

To update a policy later: `aws organizations update-policy --policy-id <id> --content "$(jq -c . <file>)" --profile org-mgmt`.

## Verify

Every check below is safe to run. The leave-organization and close-account denies are not tested live, because a missing deny would do real harm.

| #   | Command                                                                                                                                                           | Expected                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `aws dynamodb list-tables --region ap-southeast-2 --profile cvt-dev`                                                                                              | `AccessDenied … explicit deny in a service control policy`                                       |
| 2   | `aws dynamodb list-tables --region us-east-1 --profile cvt-dev`                                                                                                   | Succeeds                                                                                         |
| 3   | `aws bedrock-runtime converse --model-id us.amazon.nova-micro-v1:0 --messages '[{"role":"user","content":[{"text":"hi"}]}]' --region us-east-1 --profile cvt-dev` | Succeeds. A model access error means model access is not set up yet (S1-10), not an SCP problem. |
| 3a  | The same call with `--model-id global.anthropic.claude-haiku-4-5-20251001-v1:0`                                                                                   | Succeeds. The `global.` exemption works.                                                         |
| 3b  | The `global.` call again with `--region eu-west-1`                                                                                                                | SCP `AccessDenied`. A `global.` call can't start outside `us-east-1`.                            |
| 4   | `aws cloudtrail stop-logging --name does-not-exist --region us-east-1 --profile cvt-dev`                                                                          | SCP `AccessDenied`, not `TrailNotFoundException`                                                 |
| 5   | `aws s3api delete-object --bucket "$BUCKET" --key probe-does-not-exist --profile org-log-archive`                                                                 | SCP `AccessDenied`. Without the SCP, this is a harmless no-op.                                   |
| 6   | `aws cloudtrail describe-trails --profile org-mgmt --region us-east-1`                                                                                            | `IsOrganizationTrail: true`, `S3BucketName` is `$BUCKET`                                         |
| 7   | `aws s3 ls "s3://$BUCKET/AWSLogs/$ORG_ID/" --profile org-log-archive` (after about 15 minutes)                                                                    | One folder per account                                                                           |
| 8   | `aws organizations list-policies-for-target --target-id "$ROOT_ID" --filter SERVICE_CONTROL_POLICY --profile org-mgmt`                                            | `FullAWSAccess` and `Baseline` only                                                              |

`aws s3 ls --region <other-region>` is **not** a valid region-deny check: `s3:ListAllMyBuckets` is a global action and is exempt.

## Changing a protected setting

The log-protection SCP also blocks legitimate changes to the trail bucket (policy, lifecycle, deletes). To make one: detach `LogProtection` from `Security` in the management account, make the change, and attach it again.

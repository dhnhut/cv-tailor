# Account Access

How people sign in to the AWS accounts with IAM Identity Center (SSO). There are no IAM users and no access keys in any account ([ADR-0004](../adr/0004-accounts-and-access.md) §3).

## When to use

- Every day, before running any `aws`, `cdk`, or `pnpm --filter infra` command against a real account.
- On a new machine or a rebuilt devcontainer.
- When a new account needs SSO access.
- When sign-in fails.

## Before you start

- The AWS CLI v2 is installed (the devcontainer has it).
- `~/.aws/config` has the SSO profiles. If it doesn't, follow [2. New machine setup](#2-new-machine-setup) first.
- You have the Identity Center user name, password, and MFA device.

## 1. Daily sign-in

```bash
aws sso login --sso-session org
```

One login covers every profile, because they all share the `org` SSO session. The CLI opens a browser page. Sign in and approve the request.

If the browser can't reach the CLI (for example, the redirect to `127.0.0.1` fails inside the devcontainer), use the device code flow instead and open the printed URL in any browser:

```bash
aws sso login --sso-session org --use-device-code
```

The devcontainer mounts the host's `~/.aws`, so a login on the host also works in the container, and the other way round.

### Profiles

| Profile           | Account          | Permission set        | Credentials last | Use it for                                                                  |
| ----------------- | ---------------- | --------------------- | ---------------- | --------------------------------------------------------------------------- |
| `org-mgmt`        | Management       | `AdministratorAccess` | 1 hour           | Organizations, SCPs, the organization trail, Identity Center, Cost Explorer |
| `org-log-archive` | `log-archive`    | `AdministratorAccess` | 1 hour           | The CloudTrail log bucket                                                   |
| `cvt-dev`         | `cv-tailor-dev`  | `AdministratorAccess` | 1 hour           | Everything in `dev`                                                         |
| `cvt-stag`        | `cv-tailor-stag` | `AdministratorAccess` | 1 hour           | Everything in `stag`                                                        |
| `cvt-prod`        | `cv-tailor-prod` | `AdministratorAccess` | 1 hour           | Changes in `prod` only                                                      |
| `cvt-prod-ro`     | `cv-tailor-prod` | `ReadOnlyAccess`      | 4 hours          | Looking at `prod`. The default for `prod`.                                  |

The CLI gets new role credentials by itself while the Identity Center session is valid (8 hours by default, set in Identity Center → Settings → Authentication). After that, run `aws sso login` again.

To sign out on a shared or borrowed machine:

```bash
aws sso logout
```

## 2. New machine setup

1. Find the start URL and the account IDs in the AWS access portal (the page you see after signing in to Identity Center). Each account tile shows its ID.
2. Add this to `~/.aws/config`, replacing `<start-url>` and each `<…-account-id>`:

   ```ini
   [sso-session org]
   sso_start_url = <start-url>
   sso_region = us-east-1
   sso_registration_scopes = sso:account:access

   [default]
   region = us-east-1
   output = json

   [profile org-mgmt]
   sso_session = org
   sso_account_id = <management-account-id>
   sso_role_name = AdministratorAccess
   region = us-east-1

   [profile org-log-archive]
   sso_session = org
   sso_account_id = <log-archive-account-id>
   sso_role_name = AdministratorAccess
   region = us-east-1

   [profile cvt-dev]
   sso_session = org
   sso_account_id = <dev-account-id>
   sso_role_name = AdministratorAccess
   region = us-east-1

   [profile cvt-stag]
   sso_session = org
   sso_account_id = <stag-account-id>
   sso_role_name = AdministratorAccess
   region = us-east-1

   [profile cvt-prod]
   sso_session = org
   sso_account_id = <prod-account-id>
   sso_role_name = AdministratorAccess
   region = us-east-1

   [profile cvt-prod-ro]
   sso_session = org
   sso_account_id = <prod-account-id>
   sso_role_name = ReadOnlyAccess
   region = us-east-1
   ```

3. Sign in as in [1. Daily sign-in](#1-daily-sign-in).
4. Create the local CDK settings. They hold the account IDs and the budget alert email, and are gitignored:

   ```bash
   cp infra/.env.example infra/.env
   for env in dev stag prod; do
     echo "CVT_${env^^}_ACCOUNT_ID=$(aws sts get-caller-identity --profile "cvt-$env" --query Account --output text)"
   done
   ```

   Copy the three printed lines and the alert email into `infra/.env`.

## 3. Give the SSO group access to a new account

Access is assigned to the `Administrators` group, never to a user, so adding or removing a person is one membership change.

1. In the management account console: IAM Identity Center → AWS accounts → select the account → **Assign users or groups**.
2. Choose the **group** `Administrators` (not a user, and not a group named after a permission set), then both permission sets: `AdministratorAccess` and `ReadOnlyAccess`.
3. Add a profile for the account to `~/.aws/config`, as in [2. New machine setup](#2-new-machine-setup).
4. Check the assignments. Replace `cv-tailor-dev` with the account name:

   ```bash
   INSTANCE=$(aws sso-admin list-instances --profile org-mgmt --query 'Instances[0].InstanceArn' --output text)
   ACCOUNT=$(aws organizations list-accounts --profile org-mgmt --query "Accounts[?Name=='cv-tailor-dev'].Id" --output text)
   for PS in $(aws sso-admin list-permission-sets --instance-arn "$INSTANCE" --profile org-mgmt --query 'PermissionSets[]' --output text); do
     aws sso-admin list-account-assignments --instance-arn "$INSTANCE" --account-id "$ACCOUNT" \
       --permission-set-arn "$PS" --profile org-mgmt \
       --query 'AccountAssignments[].[PermissionSetArn,PrincipalType,PrincipalId]' --output text
   done
   ```

   Expected: two lines, one for each permission set, both with `GROUP` and the same group ID.

## Verify

```bash
aws sts get-caller-identity --profile cvt-dev --query Arn --output text
```

The ARN contains `AWSReservedSSO_AdministratorAccess_`. The account in it is the `dev` account. Repeat with any profile from the table.

## If it fails

| Symptom                                                                   | Cause and fix                                                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Token has expired and refresh failed` or `The SSO session … has expired` | The Identity Center session ended. Run `aws sso login --sso-session org`.                                                                                                  |
| `ForbiddenException: No access` when getting role credentials             | The group has no assignment for that account and permission set. Follow [3. Give the SSO group access](#3-give-the-sso-group-access-to-a-new-account).                     |
| `The config profile (…) could not be found`                               | The profile is missing from `~/.aws/config`. Follow [2. New machine setup](#2-new-machine-setup).                                                                          |
| The command works but acts on the wrong account                           | The wrong `--profile`, or `AWS_PROFILE` is set in the shell. Check with `aws sts get-caller-identity` and `echo "$AWS_PROFILE"`.                                           |
| The browser sign-in page never returns to the CLI                         | Use `--use-device-code`.                                                                                                                                                   |
| An unexpected `explicit deny in a service control policy`                 | An SCP blocks the call. Check the region (only `us-east-1` is allowed) and whether `EmergencyDeny` is attached ([budget alarm runbook](budget-alarm.md#5-emergency-stop)). |

## Break-glass access

Use these only when Identity Center sign-in doesn't work. **None of these paths have been exercised yet.** The first real use should be recorded in the sprint review.

| Path                                       | When                                                                                               | How                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Management account root user (MFA)         | Identity Center is broken or misconfigured, or the MFA device for the SSO user is lost.            | Sign in to the console as root with the root email and MFA. Fix Identity Center from there. SCPs never apply to the management account.                                                                                              |
| Privileged root session (`sts:AssumeRoot`) | A member account needs a root-only task, such as removing a bucket policy that locks everyone out. | From `org-mgmt`: `aws sts assume-root --target-principal <member-account-id> --task-policy-arn arn=arn:aws:iam::aws:policy/root-task/<task policy> --profile org-mgmt`. Only the listed AWS task policies are allowed.               |
| `OrganizationAccountAccessRole`            | Identity Center works for the management account but not for a member account.                     | From `org-mgmt`: `aws sts assume-role --role-arn arn:aws:iam::<member-account-id>:role/OrganizationAccountAccessRole --role-session-name break-glass --profile org-mgmt`. SCPs, including `EmergencyDeny`, still apply to this role. |

If the management root MFA device is lost, account recovery goes through AWS Support with the root email address (ADR-0004, Risks).

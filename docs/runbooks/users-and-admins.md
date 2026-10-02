# Users and the Admin Group

How to look up a user, and how to add or remove an admin. Membership of the `admin` group is changed by hand only ([ADR-0009](../adr/0009-sign-in-and-api-access.md) §7). No API or screen changes it.

## When to use

- Giving someone admin rights (the admin quota, QUOTA-03), or taking them away.
- Checking who is an admin.
- Checking a user's status, for example whether they confirmed their email address.

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. The person has signed up and confirmed their email address.
3. Set the environment and look up its user pool. The `<env>-Auth` stack publishes the pool ID in SSM, so no ID is written here. To change `prod`, use `cvt-prod`; to only look, use `cvt-prod-ro`.

   ```bash
   ENV=dev
   POOL=$(aws ssm get-parameter --name /cv-tailor/auth/user-pool-id --profile "cvt-$ENV" \
     --query Parameter.Value --output text)
   echo "$POOL"
   ```

   Expected: `us-east-1_` followed by letters and digits.

## 1. Find a user by email address

```bash
read -r -p 'Email: ' EMAIL
aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --filter "email = \"$EMAIL\"" \
  --query 'Users[].{Username:Username,Status:UserStatus,Enabled:Enabled}' --output table
USERNAME=$(aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --filter "email = \"$EMAIL\"" --query 'Users[0].Username' --output text)
```

Expected: one row with status `CONFIRMED`. The username is an ID that Cognito generated, because the email address is the sign-in name.

## 2. Add a user to `admin`

```bash
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$USERNAME" --group-name admin
```

No output means success. The user's tokens show the change the next time they're issued: at the next sign-in or token refresh, so within one hour.

## 3. Remove a user from `admin`

```bash
aws cognito-idp admin-remove-user-from-group --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$USERNAME" --group-name admin
```

Tokens issued before the removal still say `admin` until they expire, for up to one hour. Signing the user out everywhere (`aws cognito-idp admin-user-global-sign-out --user-pool-id "$POOL" --username "$USERNAME" --profile "cvt-$ENV"`) stops new tokens, but API Gateway accepts an access token until it expires (ADR-0009 §6).

## 4. List the admins

```bash
aws cognito-idp list-users-in-group --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --group-name admin --query "Users[].Attributes[?Name=='email'].Value[]" --output text
```

## Verify

```bash
aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$USERNAME" --query 'Groups[].GroupName' --output text
```

Expected: `admin` after step 2, and nothing after step 3.

## If it fails

- `ParameterNotFound`: `<env>-Auth` isn't deployed in that account, or the profile is wrong.
- `UserNotFoundException`, or `USERNAME` is `None`: no user has that email address in this environment. Check the spelling and `ENV`, and repeat step 1.
- `ResourceNotFoundException` for the group: group names are case-sensitive. It's `admin`.
- `ExpiredToken` or `UnauthorizedSSOToken`: sign in again with `aws sso login --sso-session org`.

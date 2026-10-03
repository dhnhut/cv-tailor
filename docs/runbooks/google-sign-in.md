# Google Sign-In

How Google sign-in is set up for an environment, how to rotate the Google client secret, how to find Google profiles that aren't linked to a local user, and how to check account linking. The design is in [ADR-0009](../adr/0009-sign-in-and-api-access.md) §2 and §4.

Each environment has its own Google Cloud project and OAuth client. In `dev`, they are the project `dev-cv-ikiwii` and the client `cognito-dev`. The client ID is public, so it's committed in `GOOGLE_CLIENT_ID` in [`infra/config/environments.ts`](../../infra/config/environments.ts). The client secret is created by hand in the environment's Secrets Manager as `cv-tailor/google-client-secret`. CloudFormation reads it when it creates or changes the Cognito identity provider. It's never committed.

## When to use

- Setting up Google sign-in for an environment.
- Rotating the Google client secret, for example after a leak.
- Google sign-in fails, or Google warns that it will delete an unused client.
- Checking for Google profiles that aren't linked to a local user.
- Checking account linking, after the pre sign-up trigger first reaches an environment or changes.

## Before you start

1. Sign in: `aws sso login --sso-session org` ([account access](account-access.md)).
2. You can open the environment's Google Cloud project (`dev-cv-ikiwii` for `dev`) with the Google account that owns it.
3. Set the environment: `ENV=dev`.
4. Once `<env>-Auth` is deployed, look up its user pool and web client. The stack publishes both IDs in SSM.

   ```bash
   POOL=$(aws ssm get-parameter --name /cv-tailor/auth/user-pool-id --profile "cvt-$ENV" \
     --query Parameter.Value --output text)
   CLIENT=$(aws ssm get-parameter --name /cv-tailor/auth/web-client-id --profile "cvt-$ENV" \
     --query Parameter.Value --output text)
   ```

## 1. Set up Google sign-in for an environment

Steps 1.1 to 1.3 come before the deploy that adds the provider. CloudFormation reads the secret during that deploy, and the deploy fails if the secret doesn't exist.

### 1.1 Google project and consent screen

In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project for the environment, for example `dev-cv-ikiwii` for `dev`. A project per environment gives each one its own branding, publishing status, and credentials.
2. Open **Google Auth Platform → Branding**. The first visit starts a **Get started** wizard.
   - App name: `CV Tailor`, with ` (<env>)` outside `prod`.
   - User support email and developer contact: the owner's address.
   - Authorized domains: `ikiwii.com`.
   - No logo. A logo makes Google require brand verification.
3. **Audience:** External. Leave the publishing status at **Testing**, with no test users. For an app that asks only for `openid` and `email`, Google applies no test-user list and shows no warning, so Testing doesn't limit who can sign in ([Google: manage app audience](https://support.google.com/cloud/answer/15549945)).
4. **Data Access** (optional): add `openid` and `.../auth/userinfo.email`. This only records what the app asks for.

### 1.2 OAuth client

1. **Google Auth Platform → Clients → Create client:**
   - Application type: **Web application**.
   - Name: `cognito-<env>`, for example `cognito-dev`.
   - Authorized JavaScript origins: none. Only Cognito talks to Google, server to server.
   - Authorized redirect URIs: `https://auth.<host>/oauth2/idpresponse`, for example `https://auth.dev.cv.ikiwii.com/oauth2/idpresponse`.
2. Choose **Create**. Google shows the client secret only in this dialog ([Google: manage OAuth clients](https://support.google.com/cloud/answer/15549257)). Keep it open and do step 1.3. Don't download the JSON file, which would leave the secret on disk. If the dialog closes first, add a new secret (section 2, step 1).
3. Note the client ID, `<number>-<letters>.apps.googleusercontent.com`, for step 1.4.

### 1.3 Store the secret

```bash
read -rs -p 'Google client secret: ' GOOGLE_SECRET; echo
aws secretsmanager create-secret --profile "cvt-$ENV" \
  --name cv-tailor/google-client-secret \
  --description 'Client secret of the Google OAuth client for Cognito sign-in (S2-06)' \
  --secret-string "$GOOGLE_SECRET" --query Name --output text
unset GOOGLE_SECRET
```

`read -s` keeps the secret off the screen and out of the shell history. Expected: `cv-tailor/google-client-secret`.

Check it without printing it:

```bash
aws secretsmanager get-secret-value --secret-id cv-tailor/google-client-secret --profile "cvt-$ENV" \
  --query 'starts_with(SecretString, `GOCSPX-`)'
```

Expected: `true`. Google client secrets start with `GOCSPX-`, so `false` means another value was pasted, for example the client ID.

### 1.4 Commit the client ID

1. Add the client ID to `GOOGLE_CLIENT_ID` in `infra/config/environments.ts`.
2. Update the tests that expect only `dev` to have Google sign-in, in `infra/test/environments.test.ts` and `infra/test/stages.test.ts`.
3. Follow the [git flow](../sprints/README.md#git-flow). Before merging, `cdk diff` for the environment shows one new `AWS::Cognito::UserPoolIdentityProvider`, `Google` added to the web client, and no replaced user pool ([deploy runbook, step 2](deploy-and-rollback.md#2-preview-a-change)).
4. After the deploy, run [Verify](#verify).

## 2. Rotate the client secret

A Google client can have two secrets, and both work until one is disabled, so rotation needs no downtime ([Google: manage OAuth clients](https://support.google.com/cloud/answer/15549257)).

1. In **Google Auth Platform → Clients**, open the client and choose **Add secret**. Copy the new secret. It's shown only once.
2. Store it:

   ```bash
   read -rs -p 'New Google client secret: ' GOOGLE_SECRET; echo
   aws secretsmanager put-secret-value --secret-id cv-tailor/google-client-secret \
     --profile "cvt-$ENV" --secret-string "$GOOGLE_SECRET" --query Name --output text
   unset GOOGLE_SECRET
   ```

3. Push it to Cognito. CloudFormation reads the secret only when it creates or changes the identity provider, so the next deploy doesn't pick up a new value ([CloudFormation: Secrets Manager references](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html)). This sends the client ID and scopes that CDK sets:

   ```bash
   CLIENT_ID=$(aws cognito-idp describe-identity-provider --user-pool-id "$POOL" \
     --provider-name Google --profile "cvt-$ENV" \
     --query IdentityProvider.ProviderDetails.client_id --output text)
   DETAILS=$(aws secretsmanager get-secret-value --secret-id cv-tailor/google-client-secret \
     --profile "cvt-$ENV" --query SecretString --output text \
     | jq -cR --arg id "$CLIENT_ID" '{client_id: $id, client_secret: ., authorize_scopes: "openid email"}')
   aws cognito-idp update-identity-provider --user-pool-id "$POOL" --provider-name Google \
     --profile "cvt-$ENV" --provider-details "$DETAILS" \
     --query IdentityProvider.LastModifiedDate --output text
   unset DETAILS
   ```

   Expected: a timestamp. Keep the `--query`, because the response includes the client secret.

4. Run [Verify](#verify), steps 1 and 3. The mapping must still show `email` and `email_verified`, and a Google sign-in must work.
5. In Google's console, **Disable** the old secret, sign in with Google again, then delete the old secret.

## 3. Find Google profiles that aren't linked

Every person is a local user, and a Google identity is linked into it (ADR-0009 §1). A user with the status `EXTERNAL_PROVIDER` is a Google identity with a user and a `sub` of its own. The pre sign-up trigger (S2-07) links each first Google sign-in to a local user instead, so new ones shouldn't appear. Ones made before the trigger was deployed stay until they're deleted. Such a Google account never reaches the trigger again, so delete its row before checking linking (section 4).

```bash
aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --filter 'cognito:user_status = "EXTERNAL_PROVIDER"' \
  --query 'Users[].{Username:Username,Created:UserCreateDate}' --output table
```

Expected: no rows.

To delete one, first check that no data is stored under its `sub`. Until the data table exists (S2-08), none is.

```bash
aws cognito-idp admin-delete-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username 'google_<id>'
```

The pool is case-insensitive, so Cognito writes these usernames in lowercase. The person's next Google sign-in counts as a first sign-in again.

## 4. Check account linking

The pre sign-up trigger links a person's first Google sign-in to the local user with the same address, or creates that user first. Each case is in ADR-0009 §2. Run these checks after the trigger first reaches an environment, and after any change to it.

They need one Gmail account, called G below, and a new private browser window for each sign-in. Sign in through the managed login link in [Verify](#verify), step 3: choose Google, or use **Sign up** for a password account.

### 4.1 Set up

1. Run section 3 and delete any row for G. Otherwise G never reaches the trigger, and the checks test nothing.
2. Set the address, and define two helpers. `users` shows G's users, their `sub`s, and their linked identities. `remove` deletes all of them between checks.

   ```bash
   read -r -p 'Gmail address (G): ' EMAIL
   users() {
     aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
       --filter "email = \"$EMAIL\"" \
       --query 'Users[].{Status:UserStatus,Sub:Attributes[?Name==`sub`]|[0].Value,Identities:Attributes[?Name==`identities`]|[0].Value}' \
       --output table
   }
   remove() {
     for name in $(aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
       --filter "email = \"$EMAIL\"" --query 'Users[].Username' --output text); do
       aws cognito-idp admin-delete-user --user-pool-id "$POOL" --profile "cvt-$ENV" --username "$name"
     done
   }
   ```

3. Find the trigger's log group, for the timing and privacy checks:

   ```bash
   TRIGGER=$(aws cognito-idp describe-user-pool --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --query UserPool.LambdaConfig.PreSignUp --output text)
   LOGS=$(aws lambda get-function-configuration --function-name "$TRIGGER" --profile "cvt-$ENV" \
     --query LoggingConfig.LogGroup --output text)
   ```

   Expected: `$TRIGGER` is a Lambda function ARN, not `None`.

### 4.2 Checks

Run `users` after each step. Note each `sub` you're asked to note.

| #   | ADR-0009 case                     | Steps                                                                                                                                      | Expected                                                                                                                                                       |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | 3: password first, Google later   | Sign up with a password as G, and enter the emailed code. Note the `sub` (S1). Then sign in with Google.                                   | One row: `CONFIRMED`, `sub` S1, and `Identities` with `"providerName":"Google"`. No `EXTERNAL_PROVIDER` row.                                                   |
| b   | 9: a later Google sign-in         | Sign in with Google again.                                                                                                                 | The same single row, `sub` S1.                                                                                                                                 |
| c   | The first sign-in after a link    | Did the Google sign-in in (a) fail once before working?                                                                                    | Record the answer. If it failed, the web app retries once (ADR-0009, risks).                                                                                   |
| d   | 4, then 2: Google first           | `remove`. Sign in with Google, and note the `sub` (S2). Then try to sign up with a password as G.                                          | The sign-up says an account with this email already exists. "Forgot password" then sets a password, and signing in with it shows `sub` S2.                     |
| e   | 5: the takeover case              | `remove`. Sign up with a password as G, but **don't** enter the code. Note the `sub` (S3, `UNCONFIRMED`). Then sign in with Google.        | One row: `CONFIRMED`, Google linked, and a `sub` that is **not** S3. Signing in with the password from the sign-up fails.                                      |
| f   | 7: confirmed, email not verified  | `remove`, then run the first block below. Sign in with Google.                                                                             | The error "An account with this email address already exists. Please sign in with your password." `users` shows the row unchanged, with no `Identities`.       |
| g   | 10: admin-created, email verified | `remove`, then run the second block below. Sign in with Google.                                                                            | Signed in. One row: `CONFIRMED`, Google linked, and the `sub` the block printed.                                                                               |
| h   | Capital letters in the address    | `remove`. Sign up with a password as G with some capital letters (for example `Alice@Gmail.com`), and enter the code. Sign in with Google. | Google is linked to the same `sub`. If the sign-in fails with "Sign-in failed. Please try again.", record it: the trigger's lookup doesn't match the capitals. |
| i   | 6: not a Gmail address (optional) | Sign in with a Google account whose address isn't a Gmail address, if you have one.                                                        | The error "Google sign-in works only for Gmail addresses. …", and no new row for that address.                                                                 |
| j   | Timing                            | After a case 4 (step d), run the third block below.                                                                                        | `Duration` plus `Init Duration` on each `REPORT` line, and the trigger's own `durationMs`, are well under 5,000 ms. Record the numbers.                        |
| k   | No personal data in logs          | Run the fourth block below.                                                                                                                | `[]`: the logs never contain G's address.                                                                                                                      |

Check f, a confirmed user whose email isn't verified:

```bash
NAME=$(aws cognito-idp admin-create-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$EMAIL" --user-attributes Name=email,Value="$EMAIL" \
  --message-action SUPPRESS --query User.Username --output text)
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$NAME" --password "$(openssl rand -base64 24)" --permanent
```

Check g, an admin-created user whose email is verified. It prints the user's `sub`:

```bash
aws cognito-idp admin-create-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$EMAIL" --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS --query 'User.Attributes[?Name==`sub`]|[0].Value' --output text
```

Check j, timing:

```bash
aws logs filter-log-events --log-group-name "$LOGS" --profile "cvt-$ENV" \
  --filter-pattern '?REPORT ?durationMs' --query 'events[].message' --output text
```

Check k, privacy:

```bash
aws logs filter-log-events --log-group-name "$LOGS" --profile "cvt-$ENV" \
  --filter-pattern "\"$EMAIL\"" --query 'events[].message'
```

### 4.3 Clean up

Run `remove`, unless G is your own account and you want to keep it. Then sign in again with the method you normally use.

## Verify

1. The identity provider. Keep the `--query`: this call returns the client secret in plain text.

   ```bash
   aws cognito-idp describe-identity-provider --user-pool-id "$POOL" --provider-name Google \
     --profile "cvt-$ENV" \
     --query 'IdentityProvider.{Type:ProviderType,ClientId:ProviderDetails.client_id,Scopes:ProviderDetails.authorize_scopes,Mapping:AttributeMapping}'
   ```

   Expected: `Google`, the committed client ID, `openid email`, and a mapping with `email` and `email_verified`. Cognito adds `username: sub` to the mapping itself.

2. The web client offers Google:

   ```bash
   aws cognito-idp describe-user-pool-client --user-pool-id "$POOL" --client-id "$CLIENT" \
     --profile "cvt-$ENV" --query UserPoolClient.SupportedIdentityProviders --output text
   ```

   Expected: `COGNITO` and `Google`.

3. Sign in with Google. Print the managed login link, and open it in a private window:

   ```bash
   WEB_HOST=dev.cv.ikiwii.com   # the environment's host
   echo "https://auth.$WEB_HOST/oauth2/authorize?response_type=code&client_id=$CLIENT&redirect_uri=https://$WEB_HOST/auth/callback&scope=openid+email"
   ```

   Expected: the page shows a Google button. Choose it and sign in. You land on `https://<host>/auth/callback?code=…`. This check never exchanges the code, so the link leaves out PKCE, which the web app always sends (S2-10). The pre sign-up trigger links the sign-in to the local user with that address, or creates one (section 4).

4. The user's email address is verified:

   ```bash
   read -r -p 'Google email address: ' EMAIL
   aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --filter "email = \"$EMAIL\"" \
     --query 'Users[].{Username:Username,Status:UserStatus,EmailVerified:Attributes[?Name==`email_verified`]|[0].Value}' \
     --output table
   ```

   Expected: one row, with the status `CONFIRMED` and `EmailVerified` `true`. A row with the status `EXTERNAL_PROVIDER` means the sign-in wasn't linked. See [If it fails](#if-it-fails).

## If it fails

- **Google shows `Error 400: redirect_uri_mismatch`:** the client's redirect URI isn't exactly `https://auth.<host>/oauth2/idpresponse`. Fix it in step 1.2.
- **The callback has `error=…` instead of `code=` after the Google step:** usually a wrong client ID or secret. Check `GOOGLE_CLIENT_ID` and the check in step 1.3. After fixing the secret, push it to Cognito (section 2, step 3), because a deploy doesn't.
- **The deploy fails because Secrets Manager can't find `cv-tailor/google-client-secret`:** the secret isn't in that account, or has another name. CloudFormation rolls the stack back by itself. Do step 1.3, then rerun the deploy ([deploy runbook, step 5](deploy-and-rollback.md#5-a-deploy-failed)).
- **The deploy fails because the CloudFormation execution role isn't allowed `secretsmanager:GetSecretValue`:** the role has `AdministratorAccess` today ([ADR-0004](../adr/0004-accounts-and-access.md) §5). If it's scoped down, it needs that action on this secret.
- **No Google button on the managed login page:** the web client doesn't list Google. Check [Verify](#verify), step 2.
- **Google shows `Error 401: deleted_client`:** Google deletes clients that are unused for 6 months, and emails a warning 30 days before. Restore it from **Deleted credentials** within 30 days, or create a new client (steps 1.2 to 1.4).
- **`email_verified` isn't `true`:** check the mapping ([Verify](#verify), step 1). Without the `email_verified` mapping, Cognito stores every Google email address as unverified.
- **The sign-in page shows "Google sign-in works only for Gmail addresses. …":** expected for a Google account whose address isn't a verified Gmail address (ADR-0009 §2, case 6). The person signs up with their email address and a password.
- **The sign-in page shows "An account with this email address already exists. Please sign in with your password.":** a local user has this address, but its email isn't verified (cases 7 and 10). The person signs in with their password. If they can't, an admin checks the user's `email_verified` attribute.
- **The sign-in page shows "Sign-in failed. Please try again.":** the trigger hit something unexpected and changed nothing more. Look in its logs (section 4.1, step 3) for `"outcome":"error"`. The line has the Cognito error's name, never the address. If a retry succeeds, the first attempt was interrupted, and case 10 finished it.
- **A Google sign-in creates a row with the status `EXTERNAL_PROVIDER`:** the trigger didn't run. Check that `describe-user-pool` shows `LambdaConfig.PreSignUp` (section 4.1, step 3), then delete the row (section 3).

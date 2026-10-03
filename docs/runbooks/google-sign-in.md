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

To delete one, first check that no data is stored under its `sub` (the `sub` attribute in `list-users`). Since S2-09, a user's first `GET /me` writes a profile item, so check their partition in the data table:

```bash
aws dynamodb query --table-name "cv-tailor-$ENV-data" --profile "cvt-$ENV" \
  --key-condition-expression 'PK = :pk' \
  --expression-attribute-values '{":pk":{"S":"USER#<sub>"}}' --select COUNT
```

Expected: `"Count": 0`. If it isn't, the profile holds data: don't delete it without deciding what happens to that data.

```bash
aws cognito-idp admin-delete-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username 'google_<id>'
```

The pool is case-insensitive, so Cognito writes these usernames in lowercase. The person's next Google sign-in counts as a first sign-in again.

## 4. Check account linking

The pre sign-up trigger links a person's first Google sign-in to the local user with the same address, or creates that user first. Each case is in ADR-0009 §2. Run these checks after the trigger first reaches an environment, and after any change to it.

They use two addresses that you can receive email at:

- **G**, a Gmail address with a Google account. It tests linking, because only Gmail addresses are linked.
- **N**, an address that isn't Gmail, ideally also a Google account (for example a Google Workspace address). It tests that such an account is never linked (case 6).

Run everything in one terminal, so the variables and helpers stay defined. "Browser" means: open the link from section 4.1, step 4, in a **new private window**, and sign in as the step says.

If G is your own account, checks 4.3 to 4.7 delete it. That gives you a new `sub`, and removes you from the `admin` group. Section 4.10 restores both. A Gmail account used only for testing avoids this.

### 4.1 Set up

1. Check that the trigger is attached, and find its log group. Expected: `$TRIGGER` is a Lambda function ARN, not `None`. `None` means the trigger isn't deployed yet.

   ```bash
   TRIGGER=$(aws cognito-idp describe-user-pool --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --query UserPool.LambdaConfig.PreSignUp --output text); echo "$TRIGGER"
   LOGS=$(aws lambda get-function-configuration --function-name "$TRIGGER" --profile "cvt-$ENV" \
     --query LoggingConfig.LogGroup --output text); echo "$LOGS"
   ```

2. Set the two addresses, and a password for the test sign-ups. Remember the password: some checks sign in with it.

   ```bash
   read -r -p 'Gmail address (G): ' G
   read -r -p 'Non-Gmail address (N): ' N
   read -rs -p 'Test password (8+ characters): ' PW; echo
   ```

3. Define the helpers. `users` shows the users with an address, with their status, `sub`, and linked identities. `remove` deletes them. `signup` and `confirm` do a password sign-up the way the web app's form does, through the same `PreSignUp_SignUp` trigger as managed login.

   ```bash
   users() {   # users <email>
     aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
       --filter "email = \"$1\"" \
       --query 'Users[].{Status:UserStatus,Sub:Attributes[?Name==`sub`]|[0].Value,Identities:Attributes[?Name==`identities`]|[0].Value}' \
       --output table
   }
   remove() {  # remove <email>: deletes every user with that address
     for name in $(aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
         --filter "email = \"$1\"" --query 'Users[].Username' --output text); do
       aws cognito-idp admin-delete-user --user-pool-id "$POOL" --profile "cvt-$ENV" --username "$name"
     done
   }
   signup() {  # signup <email>: prints the new user's sub
     aws cognito-idp sign-up --client-id "$CLIENT" --username "$1" --password "$PW" \
       --profile "cvt-$ENV" --query UserSub --output text
   }
   confirm() { # confirm <email>: asks for the code emailed to that address
     read -r -p "Code emailed to $1: " CODE
     aws cognito-idp confirm-sign-up --client-id "$CLIENT" --username "$1" \
       --confirmation-code "$CODE" --profile "cvt-$ENV"
   }
   ```

4. Print the managed login link, for every "Browser" step:

   ```bash
   WEB_HOST=dev.cv.ikiwii.com   # the environment's host
   echo "https://auth.$WEB_HOST/oauth2/authorize?response_type=code&client_id=$CLIENT&redirect_uri=https://$WEB_HOST/auth/callback&scope=openid+email"
   ```

5. Check the starting point:

   ```bash
   users "$G"; users "$N"
   ```

   Expected: no `EXTERNAL_PROVIDER` row for either address. If there is one, delete it (section 3), because that Google account never reaches the trigger. If G has no row, run `signup "$G"` and `confirm "$G"` now, for check 4.2.

### 4.2 Cases 3 and 9: password first, Google later

```bash
users "$G"   # note the sub (S1)
# Browser: choose Google, and sign in as G. Note whether the first attempt failed.
users "$G"
# Browser: sign in with Google as G again.
users "$G"
```

Expected: one `CONFIRMED` row, `sub` S1, and `Identities` with `"providerName":"Google"`, after both sign-ins. Record whether the first sign-in after the link failed once (ADR-0009, risks). If it did, the web app retries once.

### 4.3 Cases 4 and 2: Google first, password later

```bash
remove "$G"
# Browser: sign in with Google as G.
users "$G"   # note the new sub (S2)
signup "$G"  # expect UsernameExistsException: case 2
aws cognito-idp forgot-password --client-id "$CLIENT" --username "$G" --profile "cvt-$ENV"
read -r -p 'Reset code: ' CODE
aws cognito-idp confirm-forgot-password --client-id "$CLIENT" --username "$G" \
  --confirmation-code "$CODE" --password "$PW" --profile "cvt-$ENV"
# Browser: sign in as G with the password, not Google.
users "$G"
```

Expected: after the Google sign-in, one `CONFIRMED` row with Google linked. The password sign-up is refused, the password reset works, and the row still has `sub` S2.

### 4.4 Case 5: the takeover case

```bash
remove "$G"
S3=$(signup "$G"); echo "$S3"   # don't confirm it: this plays the attacker
users "$G"                      # UNCONFIRMED, sub S3
# Browser: sign in with Google as G.
users "$G"
# Browser: sign in as G with the password.
```

Expected: one `CONFIRMED` row with Google linked, and a `sub` that is **not** S3. The unconfirmed user is gone, so the password sign-in fails.

### 4.5 Case 7: confirmed, email not verified

```bash
remove "$G"
NAME=$(aws cognito-idp admin-create-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$G" --user-attributes Name=email,Value="$G" \
  --message-action SUPPRESS --query User.Username --output text)
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$NAME" --password "$PW" --permanent
# Browser: sign in with Google as G.
users "$G"
```

Expected: the error "An account with this email address already exists. Please sign in with your password." The row is unchanged: `CONFIRMED`, with no `Identities`.

### 4.6 Case 10: created by an admin, email verified

```bash
remove "$G"
aws cognito-idp admin-create-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
  --username "$G" --user-attributes Name=email,Value="$G" Name=email_verified,Value=true \
  --message-action SUPPRESS --query 'User.Attributes[?Name==`sub`]|[0].Value' --output text
# Browser: sign in with Google as G.
users "$G"
```

Expected: signed in. One `CONFIRMED` row with Google linked, and the `sub` that `admin-create-user` printed.

### 4.7 Capital letters in the address

```bash
remove "$G"
read -r -p 'G with some capital letters (for example Alice@Gmail.com): ' GC
signup "$GC"; confirm "$GC"
users "$G"; users "$GC"   # whether the lowercase lookup finds the user
# Browser: sign in with Google as G.
users "$G"; users "$GC"
remove "$G"; remove "$GC"
```

Expected: Google is linked to the user that `signup` created, with the same `sub`. If the Google sign-in fails with "Sign-in failed. Please try again.", the trigger's lookup doesn't match the capitals. Record it, because it blocks that person's Google sign-in.

### 4.8 Case 6: an address that isn't Gmail

```bash
# Browser: sign in with Google as N (skip if N isn't a Google account).
users "$N"   # no rows
signup "$N"; confirm "$N"
users "$N"   # CONFIRMED; note the sub
# Browser: sign in with Google as N.
users "$N"
remove "$N"
```

Expected: both Google sign-ins show "Google sign-in works only for Gmail addresses. …". No user is created, and the password account keeps its `sub` with no `Identities`: an account that isn't Gmail is never linked.

### 4.9 Timing and logs

```bash
aws logs filter-log-events --log-group-name "$LOGS" --profile "cvt-$ENV" \
  --filter-pattern '?REPORT ?durationMs' --query 'events[].message' --output text
for address in "$G" "$N"; do
  aws logs filter-log-events --log-group-name "$LOGS" --profile "cvt-$ENV" \
    --filter-pattern "\"$address\"" --query 'events[].message'
done
```

Expected:

- **Timing:** on each `REPORT` line, `Duration` plus any `Init Duration` is well under 5,000 ms, and so is the trigger's own `durationMs`. The slowest run is a case 4 on a cold start, which also runs the function a second time for `AdminCreateUser`. Record the numbers.
- **Personal data:** both searches print `[]`. The trigger never logs an address.

### 4.10 Clean up

1. If G is a test account, run `remove "$G"`.
2. If G is your own account, sign in with Google as G once, which creates your user again (case 4). If you're an admin, add yourself back to the group ([users and admins](users-and-admins.md)):

   ```bash
   USERNAME=$(aws cognito-idp list-users --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --filter "email = \"$G\"" --query 'Users[0].Username' --output text)
   aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --username "$USERNAME" --group-name admin
   aws cognito-idp admin-list-groups-for-user --user-pool-id "$POOL" --profile "cvt-$ENV" \
     --username "$USERNAME" --query 'Groups[].GroupName' --output text
   ```

   Expected: `admin`. To sign in with a password too, reset it as in section 4.3.

3. Clear the secrets from the shell: `unset PW CODE`.

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
- **The callback has `error=…` instead of `code=` after the Google step:** if `error_description` starts with `PreSignUp failed with error`, the pre sign-up trigger refused the sign-in; see the trigger's messages below. Otherwise it's usually a wrong client ID or secret. Check `GOOGLE_CLIENT_ID` and the check in step 1.3. After fixing the secret, push it to Cognito (section 2, step 3), because a deploy doesn't.
- **The deploy fails because Secrets Manager can't find `cv-tailor/google-client-secret`:** the secret isn't in that account, or has another name. CloudFormation rolls the stack back by itself. Do step 1.3, then rerun the deploy ([deploy runbook, step 5](deploy-and-rollback.md#5-a-deploy-failed)).
- **The deploy fails because the CloudFormation execution role isn't allowed `secretsmanager:GetSecretValue`:** the role has `AdministratorAccess` today ([ADR-0004](../adr/0004-accounts-and-access.md) §5). If it's scoped down, it needs that action on this secret.
- **No Google button on the managed login page:** the web client doesn't list Google. Check [Verify](#verify), step 2.
- **Google shows `Error 401: deleted_client`:** Google deletes clients that are unused for 6 months, and emails a warning 30 days before. Restore it from **Deleted credentials** within 30 days, or create a new client (steps 1.2 to 1.4).
- **`email_verified` isn't `true`:** check the mapping ([Verify](#verify), step 1). Without the `email_verified` mapping, Cognito stores every Google email address as unverified.
- **Where a refusal appears:** for a password sign-up, managed login shows the trigger's message above the form. For a Google sign-in, Cognito sends the browser to `https://<host>/auth/callback?error=invalid_request&error_description=PreSignUp+failed+with+error+<message>.`, and the web app shows the message (S2-10). The three messages are below.
- **"Google sign-in works only for Gmail addresses. …":** expected for a Google account whose address isn't a verified Gmail address, such as a Google Workspace address (ADR-0009 §2, case 6). The person signs up with their email address and a password.
- **"An account with this email address already exists. Please sign in with your password":** a local user has this address, but its email isn't verified (cases 7 and 10). Only an admin action creates such a user, because a self sign-up verifies its email with the emailed code. The person signs in with their password. To let them use Google instead, first check who the account belongs to, because linking gives Google's owner the account and its data. Then mark the email as verified, and their next Google sign-in links (case 3):

  ```bash
  aws cognito-idp admin-update-user-attributes --user-pool-id "$POOL" --profile "cvt-$ENV" \
    --username "$USERNAME" --user-attributes Name=email_verified,Value=true
  ```

  `USERNAME` comes from `list-users`, as in section 4.10.

- **"Sign-in failed. Please try again":** the trigger hit something unexpected and changed nothing more. Look in its logs (section 4.1, step 1) for `"outcome":"error"`. The line has the Cognito error's name, never the address. If a retry succeeds, the first attempt was interrupted, and case 10 finished it.
- **A Google sign-in creates a row with the status `EXTERNAL_PROVIDER`:** the trigger didn't run. Check that `describe-user-pool` shows `LambdaConfig.PreSignUp` (section 4.1, step 1), then delete the row (section 3).

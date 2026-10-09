# 12 Explore Dev

**Time:** 4 hours · **Week:** 3 · **Safety:** `[RO AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Sign in to AWS with read-only access, and find your own `GET /me` request in the real `dev` environment: the function, its permissions, its log line, and your profile item.

## Before you start

- [08 Request flow](08-request-flow.md) done.
- Your mentor has given you read-only access to `dev` ([account access runbook §4](../runbooks/account-access.md#4-give-a-team-member-read-only-access-to-dev)). You have the invitation email, a password, and an MFA app.
- You signed up on `dev` in [03 Setup](03-setup.md), and your User ID is in `notes.local/`.
- `dev` is up: `curl -sI https://dev.cv.ikiwii.com/ | head -1` prints `HTTP/2 200`.

## Rules for this module

Read rules 4 to 7 in [00 Rules](00-rules.md#never) again. In short:

- Use only the `cvt-dev-ro` profile. It can't change anything, but it **can read data**, so you read only your own items, by key.
- Never scan a table. In the DynamoDB console, **Explore items** runs a scan, so don't use it: use `get-item` below.
- Don't open the documents bucket, and don't list the user pool's users.
- The region is always `us-east-1` (N. Virginia). Other regions are blocked for every account.
- Everything you do is recorded in CloudTrail with your user name. That's normal, and it protects you too.

## Steps

### 1. Set up your AWS profile `[RO AWS]`

On your computer (not in the container), add the lines from [account access runbook §4.3](../runbooks/account-access.md#43-add-a-person) to `~/.aws/config`. The start URL is in your invitation email; the `dev` account ID is on the account tile in the AWS access portal. Never commit or paste them anywhere public.

Then, in the container:

```bash
aws sso login --sso-session org --use-device-code
```

Open the printed URL in your browser, sign in, and approve. The login lasts a few hours; when a command says your token has expired, run it again.

### 2. Prove you're read-only `[RO AWS]`

```bash
aws sts get-caller-identity --profile cvt-dev-ro --query Arn --output text
```

Expected: an ARN that contains `AWSReservedSSO_ReadOnlyAccess_` and ends with your user name.

```bash
aws ec2 create-key-pair --key-name read-only-check --dry-run --profile cvt-dev-ro
```

Expected: an error with `UnauthorizedOperation`. `--dry-run` only asks "would I be allowed?", so nothing is created either way.

### 3. Read the kill switch `[RO AWS]`

```bash
aws ssm get-parameter --name /cv-tailor/ai-calls --profile cvt-dev-ro --query Parameter.Value --output text
```

Expected: `enabled`, unless your mentor has turned AI calls off. Only your mentor changes it ([kill switch runbook](../runbooks/kill-switch.md)).

### 4. Compare the deployed function with the code `[RO AWS]`

```bash
aws lambda get-function-configuration --function-name cv-tailor-dev-me --profile cvt-dev-ro \
  --query '{runtime: Runtime, arch: Architectures, memory: MemorySize, timeout: Timeout, env: keys(Environment.Variables)}'
```

Expected: `nodejs24.x`, `arm64`, `512`, `10`, and the variables `ALLOWED_ORIGIN` and `TABLE_NAME`. Find each value in `infra/modules/lambda-function/main.tf` and in the `me` entry of `functions` in `infra/modules/api/main.tf`.

```bash
aws iam get-role-policy --role-name cv-tailor-dev-me --policy-name Calls --profile cvt-dev-ro \
  --query PolicyDocument
```

Expected: one statement that lets the function write to its own log group, and one that allows exactly `dynamodb:GetItem` and `dynamodb:PutItem` on the `cv-tailor-dev-data` table. Compare it with the `me` statements in `infra/modules/api/main.tf`, and with the comment at the top of `apps/api/src/data/profiles.ts`.

### 5. Find your own request in the logs `[RO AWS]`

1. Open `https://dev.cv.ikiwii.com`, sign in, and open **Your profile**. Note the time.
2. Read the last 15 minutes of the function's log:

   ```bash
   aws logs tail /aws/lambda/cv-tailor-dev-me --since 15m --profile cvt-dev-ro
   ```

Expected: lines from Lambda (`START`, `END`, and `REPORT` with the duration and memory), and a line from our code like `{"route":"GET /me","outcome":"existing","isAdmin":false,"durationMs":…}`.

The line has no user ID, on purpose (SAFE-04). So you find **your** request by its time, not by searching for your ID. Don't use the wider search tools (Logs Insights, Live Tail): they cost money and can show other people's requests.

### 6. Read your own profile item `[RO AWS]`

Put your User ID from `notes.local/` in a variable, then read exactly one item, by its key:

```bash
SUB=<your User ID>
aws dynamodb get-item --table-name cv-tailor-dev-data --profile cvt-dev-ro \
  --key "{\"PK\":{\"S\":\"USER#$SUB\"},\"SK\":{\"S\":\"PROFILE\"}}"
```

Expected: an item with `PK`, `SK`, `Entity` (`Profile`), and `createdAt`, the moment of your first visit to your profile page in week 1. Find where each attribute is written: `profileKey` in `apps/api/src/data/keys.ts`, and `ensureProfile` in `apps/api/src/data/profiles.ts`.

### 7. A short console tour `[RO AWS]`

Open the AWS access portal, choose `cv-tailor-dev` → `ReadOnlyAccess`, and check that the region at the top right is **N. Virginia (us-east-1)**. Look, don't click buttons that change things (they'll fail anyway):

| Service         | Find                                                            | Matches                                 |
| --------------- | --------------------------------------------------------------- | --------------------------------------- |
| CloudFront      | The distribution for `dev.cv.ikiwii.com`                        | `infra/modules/web/`                    |
| API Gateway     | The REST API, its four routes, the authorizer, and stage `live` | `infra/modules/api/main.tf`             |
| Lambda          | The five `cv-tailor-dev-*` functions                            | The five bundles from module 04         |
| CloudWatch Logs | One log group per function                                      | `infra/modules/lambda-function/main.tf` |
| DynamoDB        | The table's settings tab only (not "Explore items")             | `infra/modules/data/main.tf`            |
| Systems Manager | Parameter Store: `/cv-tailor/ai-calls`                          | `infra/modules/kill-switch/main.tf`     |

## Verify

- `sts get-caller-identity` shows `ReadOnlyAccess`, and the dry-run write is refused.
- You found your log line by its time, and your profile item by its key.

## Check your understanding

1. How do you prove that your access is read-only?

   <details>
   <summary>Answer</summary>

   The ARN shows the `ReadOnlyAccess` role, and a write such as `ec2 create-key-pair --dry-run` returns `UnauthorizedOperation`.

   </details>

2. Why can't you search the logs for your user ID?

   <details>
   <summary>Answer</summary>

   It's never logged. SAFE-04 keeps personal data out of logs, so the handler logs only the route, the outcome, the role, and the time taken.

   </details>

3. Why `get-item` and never `scan`?

   <details>
   <summary>Answer</summary>

   `get-item` reads exactly one item whose key you know: your own. A scan reads every item in the table, including other people's data.

   </details>

4. Something looks wrong in `dev`, for example AI calls misbehave. What do you do?

   <details>
   <summary>Answer</summary>

   Tell your mentor, with what you saw and when. You can't change anything, including the kill switch, and that's by design.

   </details>

## If you get stuck

| Symptom                                                | Cause and fix                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Token has expired` or `The SSO session … has expired` | Run `aws sso login --sso-session org --use-device-code` again.                                                      |
| `ForbiddenException: No access`                        | `sso_role_name` must be `ReadOnlyAccess`, and the account ID must be `dev`'s. Ask your mentor to check your access. |
| `explicit deny in a service control policy`            | You're in another region. Add `--region us-east-1`, or check `region` in your profile.                              |
| `aws logs tail` prints nothing                         | No request in the last 15 minutes. Open your profile page again, or use `--since 1h`.                               |
| `get-item` prints nothing                              | The key doesn't match. Check your User ID: lowercase, with dashes, and `USER#` before it.                           |

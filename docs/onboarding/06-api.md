# 06 API

**Time:** 8 hours · **Week:** 2 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Read and test the API's Lambda functions: how a handler knows who is calling, how it reads and writes DynamoDB, how it answers, and how it's tested without AWS.

## Before you start

- [05 Contracts](05-contracts.md) done.

## Learn first

- [02 Learning path](02-learning-path.md): 3 (HTTP), 6 (Vitest), and 8 (Lambda and DynamoDB).

## Read

Read in this order. Each file is short, and each builds on the one before.

1. `apps/api/src/handlers/http.ts`, `log.ts`, and `apps/api/src/env.ts`. Look for: every response carries the CORS header; errors never contain details; a log line never contains personal data.
2. `apps/api/src/handlers/claims.ts`. Look for: how the caller's `sub` and groups come from the authorizer's claims, and why `token_use` must be `access`.
3. `apps/api/src/data/keys.ts`. Look for: one table for everything, with keys such as `PK = USER#<sub>` and `SK = PROFILE` ([ADR-0006](../adr/0006-data-store.md)), and why IDs are UUID v7.
4. `apps/api/src/data/profiles.ts`. Look for: a read, then a write with a condition, and what happens when two requests race.
5. `apps/api/src/handlers/me/handler.ts`. Look for: `createHandler(deps)`, a function that builds the handler, and the real wiring at the bottom of the file, which runs once when the Lambda starts (a "cold start").
6. `apps/api/test/aws-fakes.ts`, `test/data/profiles.test.ts`, and `test/handlers/me/handler.test.ts`. Look for: how tests pass a fake `send` instead of a real AWS client.
7. `infra/modules/api/main.tf`, only `locals` (`functions` and `routes`) and the authorizer. Look for: each route has its own Lambda, and each Lambda may make only the calls its code makes.
8. The document API: `packages/contracts/src/documents.ts`, `apps/api/src/handlers/documents/create.ts`, then `apps/api/src/documents/service.ts`, `storage/documents-bucket.ts`, and `data/documents.ts`. Look for: how each business result becomes a status code (201, 200, 400, 403, 404, 409), and how a presigned URL lets the browser upload straight to S3. These are the hardest files in the API; take your time.
9. Optional deep dive: the pre sign-up trigger, `apps/api/src/triggers/pre-sign-up/rules.ts`, `cognito.ts`, and `handler.ts`, with [ADR-0009](../adr/0009-sign-in-and-api-access.md) §2.

### The handler pattern

```text
me/handler.ts
├── createHandler({ store, allowedOrigin, now })    pure logic: tests call this with fakes
│     └── async (event) => {
│           readCaller(event)        who is calling?             → 500 if the claims are missing
│           MeResponse.parse(…)      does the body fit?          → 500 if not, and nothing is written
│           store.ensureProfile(…)   DynamoDB GetItem / PutItem  → 500 with only the error's name logged
│           jsonResponse(200, body)  JSON + CORS + no-store
│         }
└── export const handler = createHandler({ real DynamoDB store, settings from the environment })
```

## Do

Use [the practice routine](README.md#the-practice-routine) for A2 and A3, on a branch such as `practice/06-api`.

### A1 Run the tests `[No AWS]`

```bash
pnpm --filter @cv-tailor/api test
```

Expected: every test passes, with a coverage table. Now run one file without the coverage gate:

```bash
pnpm --filter @cv-tailor/api exec vitest run test/handlers/me/handler.test.ts
```

Expected: `Tests  10 passed (10)`.

### A2 Leak personal data into a log `[No AWS]`

In `apps/api/src/handlers/me/handler.ts`, change the success log line to:

```ts
console.log(line({ outcome, isAdmin: caller.isAdmin, sub: caller.sub }));
```

Predict which tests fail, then run the file again.

Expected: 2 failures: "returns the caller, and creates their profile on the first call" and "never logs the sub, the scope, or the groups". The tests guard SAFE-04: personal data never goes into logs. Reset.

### A3 Remove the condition `[No AWS]`

In `apps/api/src/data/profiles.ts`, delete the line `ConditionExpression: 'attribute_not_exists(#pk)',`. Run:

```bash
pnpm --filter @cv-tailor/api exec vitest run test/data/profiles.test.ts
```

Expected: 2 failures: "creates the profile on the first call, only if no item has this key" and "treats a failed condition as existing: a concurrent call created it first". The tests check the exact request sent to DynamoDB. In your notes, explain what would go wrong without the condition when two tabs open the profile page at the same moment. Reset.

### A4 Add test cases `[No AWS]`

Open `apps/api/test/handlers/claims.test.ts`. The `parseGroups` table lists every format the groups claim has been seen in. Add two rows, predict each result, and run the file:

- `['tab-separated', 'admin\teditors', ['admin', 'editors']]`
- `['semicolon-separated', 'admin;editors', ['admin', 'editors']]`

Which passes, which fails, and why? (Read the regular expression in `parseGroups`.) A new test should fail first when it describes something the code doesn't do yet. Reset.

### A5 Requirements to tests `[No AWS]`

Read the S3-07 row in the [Sprint 3 backlog](../sprints/sprint-03-knowledge-base-and-first-agent.md#backlog). For each acceptance criterion, find the `describe` block in `apps/api/test/documents/service.test.ts` that proves it, for example "isolation (S3-07: user A can't list or delete user B's documents)". Note any criterion you can't find a test for, and ask your mentor how it was checked.

## Verify

You can explain, for `GET /me`, where the caller comes from, what is written to DynamoDB and when, and what is logged.

## Check your understanding

1. Why does each handler export a `createHandler(deps)` as well as `handler`?

   <details>
   <summary>Answer</summary>

   Tests call `createHandler` with fakes, so they need no AWS. The deployed `handler` is built once, at cold start, with the real clients and the environment's settings.

   </details>

2. Why does the handler answer 500, not 401, when the claims are missing?

   <details>
   <summary>Answer</summary>

   The authorizer has already refused requests without a valid access token. Missing claims mean the API is misconfigured: our bug, not the caller's. A 500 shows up in the error metrics instead of looking like a bad token.

   </details>

3. Why `attribute_not_exists` on the profile write?

   <details>
   <summary>Answer</summary>

   Two first calls at the same time could both miss the read. The condition lets only one write succeed; the other gets `ConditionalCheckFailedException`, which counts as "existing". No profile is ever overwritten.

   </details>

4. You add a new DynamoDB call to a handler. What else must change in the same pull request?

   <details>
   <summary>Answer</summary>

   The function's IAM statement in `infra/modules/api/main.tf`, and the exact-match check in `infra/stacks/workload/tests/api.tftest.hcl`, plus the handler's own tests. Without the IAM change, the call is refused in `dev` with `AccessDenied` (module 10).

   </details>

## If you get stuck

- A test name is long: run only that test with `-t`, for example `pnpm --filter @cv-tailor/api exec vitest run test/handlers/me/handler.test.ts -t "never logs"`.
- An AWS SDK type is confusing: ask your AI tutor what the command does, then find it in the AWS SDK docs.

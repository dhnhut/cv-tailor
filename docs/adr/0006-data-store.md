# ADR-0006: Data Store, a Single DynamoDB Table

| Field       | Value                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                                                                                                                                                                                                        |
| Date        | 2026-10-01                                                                                                                                                                                                                                                      |
| Amended     | 2026-10-03: the table's resource type, its guards against replacement, and UTC quota periods are recorded, and verification steps 1 and 4 are updated (S2-08); 2026-10-06: document and job IDs are lowercase UUID v7, and verification step 5 is added (S3-03) |
| Deciders    | Project owner                                                                                                                                                                                                                                                   |
| Sprint item | S1-13                                                                                                                                                                                                                                                           |

## Context

`AGENTS.md` §7 names Amazon DynamoDB as the database. Before the first table is created in Sprint 2 ([ADR-0005](0005-mvp-scope.md)), the project needs to decide how data is laid out, and to check that DynamoDB is still the right store.

The MVP stores a small set of records. Every read starts from the signed-in user, whose ID is the Cognito `sub`:

| Entity                  | Read path                                                |
| ----------------------- | -------------------------------------------------------- |
| User profile            | By user                                                  |
| Quota override          | By user                                                  |
| Quota counters          | By user and day or month, updated on every AI call       |
| Knowledge base document | By user (list), by user and document ID                  |
| Generation job          | By user (list), by user and job ID                       |
| Whole account           | By user, to delete everything when an account is deleted |

The kill switch is a flag in SSM Parameter Store, not a DynamoDB item.

### Decision drivers

1. **Serverless and pay per use:** no fixed monthly cost at low traffic. The `dev` budget is USD 5 per month.
2. **Inside the AWS Organization:** covered by the SCPs, CloudTrail, AWS Budgets, and IAM, with no extra secrets to manage.
3. **Safe concurrent counters:** quota updates must be atomic and must not go over the limit under concurrent calls.
4. **Easy to manage:** few resources to define, back up, and grant access to.
5. **Easy to change** while access patterns are still being discovered.

## Options Considered

### Option A: DynamoDB, one table per entity

- **Pros:** each table has a simple key that matches its entity. IAM can be scoped to one table per function.
- **Cons:** every new entity adds a table, with its own CDK definition, grants, backup setting, and tests. Deleting an account touches every table.

Rejected, because it fails driver 4 without a benefit the MVP needs.

### Option B: Amazon DocumentDB Serverless (MongoDB-compatible)

- **Pros:** flexible queries and a familiar MongoDB API.
- **Cons:** billed per DCU-hour with a 0.5 DCU minimum, which is about USD 30 per month even when idle unless the cluster is paused [1]. It runs inside a VPC, so Lambda and AgentCore would need VPC access.

Rejected, because it fails driver 1: the minimum alone is about six times the `dev` budget.

### Option C: MongoDB Atlas

- **Pros:** flexible queries, a free tier for small clusters, and built-in vector search.
- **Cons:** it runs outside the AWS Organization, so the SCPs, CloudTrail, AWS Budgets, and the emergency deny SCP don't cover it. Lambda has no fixed IP address, so the Atlas IP allowlist would have to be wide open unless a paid private connection is used. It needs a connection-string secret, and it has a separate bill.

Rejected, because it fails driver 2. The managed knowledge base ([ADR-0007](0007-knowledge-base-store.md)) already provides vector search, so Atlas's vector search adds nothing.

### Option D: DynamoDB, a single table with generic keys and an `Entity` attribute (chosen)

- **Pros:** one table to define, grant, and back up. On-demand capacity with no minimum cost, IAM authentication, and no VPC. Covered by every guardrail in [ADR-0004](0004-accounts-and-access.md). Every MVP read path is a query on one user's partition, so no secondary index is needed. Deleting an account is one query. Atomic counters with conditions and TTL fit the quota.
- **Cons:** IAM can limit a role to certain partition keys, but not to certain kinds of item, so a function that can read one kind of item in a user's partition can read the others. A scan returns every kind of item.

## Decision

**Amazon DynamoDB, one table per environment (`cv-tailor-<env>-data`), with on-demand capacity.**

### Keys

- Generic key names: partition key `PK` and sort key `SK`, both strings. The key values carry the meaning, so a new kind of item needs no new table.
- Every item has an `Entity` attribute that names its kind, so a scan or an export can be filtered by kind.
- TTL is turned on for the `expiresAt` attribute. Only items that should expire carry it.
- Quota days and months are UTC (QUOTA-02): `<date>` is `YYYY-MM-DD` and `<month>` is `YYYY-MM`.
- Every key is built by one module, `apps/api/src/data/keys.ts`. It refuses a `sub` that isn't a lowercase UUID and an ID that isn't a lowercase UUID v7, so a wrong value can't make a valid-looking key in the wrong partition.

| Item            | `PK`         | `SK`                  | `Entity`        | Notes                                             |
| --------------- | ------------ | --------------------- | --------------- | ------------------------------------------------- |
| Profile         | `USER#<sub>` | `PROFILE`             | `Profile`       | `createdAt` (UTC), written on the first `GET /me` |
| Quota override  | `USER#<sub>` | `QUOTA_OVERRIDE`      | `QuotaOverride` | Set by an admin (ADMIN-02)                        |
| Daily counter   | `USER#<sub>` | `QUOTA#DAY#<date>`    | `QuotaCounter`  | `expiresAt` after the UTC day ends                |
| Monthly counter | `USER#<sub>` | `QUOTA#MONTH#<month>` | `QuotaCounter`  | `expiresAt` after the UTC month ends              |
| KB document     | `USER#<sub>` | `DOC#<id>`            | `KbDocument`    | Metadata only; the file is in S3                  |
| Generation job  | `USER#<sub>` | `JOB#<id>`            | `GenerationJob` |                                                   |

### IDs for documents and jobs

- **Format:** UUID version 7 [5], lowercase, with hyphens, 36 characters, for example `019ab3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b`. `keys.ts` refuses every other shape, including UUID v4, ULIDs, and capital letters, so one item can't have two valid IDs.
- **Generator:** Node's built-in `crypto.randomUUIDv7()`, added in Node 24.16.0 [4], so no dependency is needed. Only the API creates IDs, so only TypeScript needs a generator. `keys.ts` exports it as `newId()`. The Lambda Node 24 base image runs Node 24.21.0 (checked 2026-10-06).
- **Why time-ordered:** the first 48 bits are the creation time in Unix milliseconds [5], written as fixed-width lowercase hex. DynamoDB sorts a string sort key by its bytes, so `DOC#` and `JOB#` keys sort by creation time. A query on `begins_with(SK, 'JOB#')` with `ScanIndexForward: false` lists a user's jobs newest first, with no index and no sort in code.
- **Options rejected:** UUID v4 is built in but random, so listing newest first would need a sort in code or an index. A ULID is time-ordered but needs a dependency and has no standard library support.
- **Limits:** the order is to the millisecond only. Node fills the bits after the timestamp at random, with no counter, so two IDs from the same millisecond are in random order. Order across Lambda instances depends on their clocks. An ID reveals when its item was created. That is acceptable because only the owner sees these IDs, and they see `createdAt` anyway. Public IDs (chatbot page, coupon) are decided with those features.

### Access

- A user's documents are listed with a query on `PK = USER#<sub>` and `SK` beginning with `DOC#`, and jobs the same way with `JOB#`.
- Quota counters are updated with a single `UpdateItem` that adds the cost with `ADD` and uses a `ConditionExpression` to refuse an update that would pass the limit.
- Deleting an account queries `PK = USER#<sub>` and deletes every item it returns.
- Each function's IAM grant is limited to the table, and where possible to the caller's own partition (`dynamodb:LeadingKeys`).
- A global secondary index is added only when a feature needs a read that doesn't start from a user, for example a chatbot page by its public ID or a coupon by its code.

### Operations

- The table is defined in CDK in the workload stage, in its own stack, `<env>-Data`. Point-in-time recovery is on, because the table holds user data.
- The table is an `AWS::DynamoDB::GlobalTable` with one replica in `us-east-1` (CDK's `TableV2`, which CDK prefers for every table [3]). A global table in a single region is billed the same as a single-region table. CloudFormation can't change an `AWS::DynamoDB::Table` into a `GlobalTable` in place, and trying "might result in the deletion of your DynamoDB table" [2], so the type was chosen before the table held any data. A second region can later be added as a replica without replacing the table.
- A replaced table would be a new, empty table. So the table has deletion protection, a retain policy, and a fixed logical ID, and its stack has termination protection. Its name is fixed (`cv-tailor-<env>-data`), so a change that needs a replacement fails instead of creating an empty table.
- Other stacks find the table by its fixed name, not through a CloudFormation export, so no export ties a stack to `<env>-Data`.

## Consequences

### Positive

- One table to manage in each environment.
- No fixed cost at low traffic, and no VPC.
- The quota limit holds under concurrent calls, because the check and the update are one atomic operation.
- A user's data is one partition, so account deletion and data export are one query each.

### Negative

- IAM can't separate kinds of item within a user's partition. Isolation between kinds relies on the application code and its tests.
- Reports across users (for admins) need a scan filtered by `Entity`, or an export. That is acceptable at low volume.
- Every key format is a convention in code, so the formats live in one module with tests, not spread across handlers.

### When to revisit this decision

- A function needs strict least-privilege access to one kind of item: move that kind to its own table.
- Admin reporting needs ad-hoc queries: export to S3 and query it with Athena, rather than changing the main table.

## Verification

1. `cdk synth` shows exactly one DynamoDB table per environment: an `AWS::DynamoDB::GlobalTable` with `BillingMode: PAY_PER_REQUEST` and TTL on `expiresAt`, and one replica, in `us-east-1`, with point-in-time recovery and deletion protection on.
2. A test for the quota counter shows that two concurrent updates that together pass the limit result in one success and one `ConditionalCheckFailedException`.
3. A test for account deletion shows that every item under `USER#<sub>` is removed and items of other users are not.
4. A daily counter item carries `expiresAt` set to the end of its UTC day.
5. `keys.test.ts` shows that `newId()` makes an ID the keys accept, that the ID starts with its creation time, and that the keys refuse a UUID v4, a ULID, and capital letters.

## Sources

1. Amazon DocumentDB pricing (Serverless DCU-hour rate and minimum capacity): <https://aws.amazon.com/documentdb/pricing/>, accessed 2026-10-01
2. `AWS::DynamoDB::GlobalTable` (single-region billing, and converting from `AWS::DynamoDB::Table`): <https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-globaltable.html>, accessed 2026-10-03
3. AWS CDK `aws-dynamodb` README, aws-cdk-lib 2.271.0: "`TableV2` is the preferred construct for all use cases, including creating a single table", read 2026-10-03
4. Node.js v24 documentation, `crypto.randomUUIDv7([options])` ("added: v24.16.0"): <https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidv7options>, accessed 2026-10-06
5. RFC 9562, Universally Unique IDentifiers (UUIDs), §5.7 UUID Version 7: <https://www.rfc-editor.org/rfc/rfc9562#section-5.7>, accessed 2026-10-06

# ADR-0006: Data Store, a Single DynamoDB Table

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-10-01    |
| Deciders    | Project owner |
| Sprint item | S1-13         |

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
- **Cons:** billed per DCU-hour with a 0.5 DCU minimum, which is about USD 30 per month even when idle unless the cluster is paused. It runs inside a VPC, so Lambda and AgentCore would need VPC access.

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

| Item            | `PK`         | `SK`                  | `Entity`        | Notes                            |
| --------------- | ------------ | --------------------- | --------------- | -------------------------------- |
| Profile         | `USER#<sub>` | `PROFILE`             | `Profile`       |                                  |
| Quota override  | `USER#<sub>` | `QUOTA_OVERRIDE`      | `QuotaOverride` | Set by an admin (ADMIN-02)       |
| Daily counter   | `USER#<sub>` | `QUOTA#DAY#<date>`    | `QuotaCounter`  | `expiresAt` after the day ends   |
| Monthly counter | `USER#<sub>` | `QUOTA#MONTH#<month>` | `QuotaCounter`  | `expiresAt` after the month ends |
| KB document     | `USER#<sub>` | `DOC#<id>`            | `KbDocument`    | Metadata only; the file is in S3 |
| Generation job  | `USER#<sub>` | `JOB#<id>`            | `GenerationJob` |                                  |

### Access

- A user's documents are listed with a query on `PK = USER#<sub>` and `SK` beginning with `DOC#`, and jobs the same way with `JOB#`.
- Quota counters are updated with a single `UpdateItem` that adds the cost with `ADD` and uses a `ConditionExpression` to refuse an update that would pass the limit.
- Deleting an account queries `PK = USER#<sub>` and deletes every item it returns.
- Each function's IAM grant is limited to the table, and where possible to the caller's own partition (`dynamodb:LeadingKeys`).
- A global secondary index is added only when a feature needs a read that doesn't start from a user, for example a chatbot page by its public ID or a coupon by its code.

### Operations

- The table is defined in CDK in the workload stage. Point-in-time recovery is on, because the table holds user data.

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

1. `cdk synth` shows exactly one `AWS::DynamoDB::Table` per environment, with `BillingMode: PAY_PER_REQUEST`, point-in-time recovery on, and TTL on `expiresAt`.
2. A test for the quota counter shows that two concurrent updates that together pass the limit result in one success and one `ConditionalCheckFailedException`.
3. A test for account deletion shows that every item under `USER#<sub>` is removed and items of other users are not.
4. A daily counter item carries `expiresAt` set to the end of its day.

## Sources

- Amazon DocumentDB pricing (Serverless DCU-hour rate and minimum capacity): <https://aws.amazon.com/documentdb/pricing/>, accessed 2026-10-01

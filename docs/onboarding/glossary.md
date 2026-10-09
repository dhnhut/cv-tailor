# Glossary

Words you'll meet in this project, in alphabetical order. Each entry says what the word means here, and where to look.

### Access token

A short-lived token that proves who you are to the API. The web app sends it in the `Authorization: Bearer …` header. The API accepts access tokens only, never ID tokens ([ADR-0009](../adr/0009-sign-in-and-api-access.md)). See [ID token](#id-token) and [JWT](#jwt).

### ADR

Architecture decision record: a document that records one decision, the options, and the trade-offs. They're in [`docs/adr/`](../adr/). See [01 The product](01-product.md#how-to-read-an-adr).

### AgentCore

Amazon Bedrock AgentCore, the AWS platform that hosts the AI agents ([`AGENTS.md`](../../AGENTS.md) §5.4).

### API

Application programming interface: here, the HTTP endpoints the web app calls, such as `GET /me`. The code is in `apps/api/`.

### API Gateway

The AWS service that receives HTTP requests at `api.<host>`, checks the caller's token, and passes each request to a Lambda function.

### Authorizer

API Gateway's check that runs before any Lambda function. Here, a Cognito authorizer checks the access token's signature, expiry, and scope. See [08 Request flow](08-request-flow.md).

### AWS account

A container for AWS resources, with its own permissions and bill. CV Tailor has one account per environment ([ADR-0004](../adr/0004-accounts-and-access.md)).

### AWS CLI profile

A named set of AWS settings in `~/.aws/config`, chosen with `--profile`. Yours is `cvt-dev-ro` (read-only, `dev` only).

### Bedrock

The AWS service that runs AI models. Every call to it goes through the AI call guard in `services/agents/`.

### Branch

A separate line of commits in git. You work on your own branch, and it joins `main` through a pull request.

### Bundle

One JavaScript file that holds a program and everything it imports. esbuild makes one bundle for each Lambda function.

### CD

Continuous delivery (or deployment): every change merged to `main` is deployed automatically. Here, to `dev`.

### CI

Continuous integration: every push is checked automatically. Here, the `check` job in `.github/workflows/ci.yml`.

### Claim

One field inside a token, such as `sub`, `token_use`, or `cognito:groups`. The API reads the caller's claims in `apps/api/src/handlers/claims.ts`.

### CloudFront

The AWS content delivery network that serves the web app's files to browsers.

### CloudTrail

The AWS service that records every API call made in an account: who did what, and when.

### Cognito

Amazon Cognito: the AWS service for sign-up and sign-in. It holds the users of CV Tailor (not of AWS) in a user pool.

### Cold start

The first run of a Lambda function in a fresh container. Code at the top level of a module, outside the handler, runs once then.

### Commit

A saved set of changes in git, with a message. Here, every message starts with a sprint item ID, such as `S3-07`.

### Condition expression

A rule DynamoDB checks before a write, such as `attribute_not_exists(#pk)`. If the rule fails, nothing is written. See [06 API](06-api.md).

### Contract

The agreed shape of data that crosses a boundary, such as an API response. Written in Zod in `packages/contracts/` ([ADR-0003](../adr/0003-contracts-codegen.md)).

### CORS

Cross-origin resource sharing: the browser's rule about which websites may call an API on another address.

### Coverage

The share of code that tests run. Every package must stay at 80% or more, or CI fails.

### Dependabot

GitHub's bot that opens pull requests to update dependencies every week (`.github/dependabot.yml`).

### Dev container

A Docker container with every tool the project needs, defined in `.devcontainer/`. See [03 Setup](03-setup.md).

### Drift check

`pnpm run contracts:check`: it generates the contracts again and fails if they differ from what is committed. See [05 Contracts](05-contracts.md).

### DynamoDB

The AWS NoSQL database. CV Tailor stores its data in one table ([ADR-0006](../adr/0006-data-store.md)).

### Environment

A separate copy of the whole system: `dev` for development, `stag` for staging, and `prod` for real users. Each is in its own AWS account.

### esbuild

The tool that bundles each API Lambda function into one file (`pnpm --filter @cv-tailor/api build`).

### Fail closed

When unsure, refuse. The kill switch blocks AI calls unless it reads exactly `enabled`.

### Fake

A simple stand-in for a real dependency in a test, such as a `send` function that returns prepared answers instead of calling AWS.

### Generated file

A file a program writes, which you never edit by hand. `pnpm run generate` writes them. See [04 Repo tour](04-repo-tour.md#generated-files).

### GitHub Actions

GitHub's automation service. It runs the workflows in `.github/workflows/`.

### GitHub Environment

A named deploy target, `dev`, with rules such as which branch may deploy to it. CI's AWS role trusts only this environment.

### Golden rule

The product's first rule: the agent never invents a fact that isn't in the candidate's own documents ([`AGENTS.md`](../../AGENTS.md) §5.1).

### IAM

Identity and Access Management: the AWS service that decides who may do what. An **IAM role** is a set of permissions that a person, a service, or CI takes on for a short time.

### ID token

A token that describes the person who signed in, such as their email address. The web app reads it; the API never accepts it. See [Access token](#access-token).

### Infrastructure as code

Describing cloud resources in files that are reviewed, tested, and applied by a tool, instead of clicking in a console. Here, with OpenTofu in `infra/`.

### Item

One record in a DynamoDB table, found by its key (`PK` and `SK`).

### JSON

JavaScript Object Notation: the text format the web app and the API use to exchange data.

### JWT

JSON Web Token: a signed token in three parts separated by dots. Access tokens and ID tokens are JWTs. Never paste a real one anywhere.

### Kill switch

The SSM parameter `/cv-tailor/ai-calls`. When it isn't `enabled`, every AI call is refused (ADMIN-03, [kill switch runbook](../runbooks/kill-switch.md)). You never change it.

### Lambda

AWS Lambda: runs a function when an event arrives, such as an HTTP request, without a server to manage. Each API route has its own function.

### Lint

A tool that finds likely mistakes and style problems without running the code. Here: ESLint for TypeScript, ruff for Python, TFLint for OpenTofu.

### Lockfile

A file that pins the exact version of every package, so every install is the same: `pnpm-lock.yaml` and `services/agents/uv.lock`.

### Log group

Where CloudWatch Logs keeps one function's logs, named `/aws/lambda/<function name>`.

### MFA

Multi-factor authentication: a second proof of identity, such as a code from an app, on top of a password.

### Mock provider

In `tofu test`, a fake AWS provider that answers without calling AWS. See [10 Infrastructure](10-infrastructure.md).

### Monorepo

One repository that holds several packages. See [ADR-0001](../adr/0001-monorepo-pnpm-workspaces.md).

### MVP

Minimum viable product: the first release that is useful end to end ([ADR-0005](../adr/0005-mvp-scope.md)).

### OIDC

OpenID Connect: a standard way to prove an identity with a signed token. CI uses it to get short-lived AWS credentials without stored keys. Sign-in uses it too.

### Open redirect

A bug that lets a link send people from our site to another one, for example after sign-in. `apps/web/src/auth/return-path.ts` prevents it.

### OpenTofu

The infrastructure-as-code tool this project uses (`tofu`). See [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md).

### Partition key and sort key

The two parts of a DynamoDB item's key. Here, `PK` is `USER#<sub>`, and `SK` says what the item is, such as `PROFILE` or `DOC#<id>`.

### Permission set

In IAM Identity Center, a named set of permissions that a group gets in an AWS account, such as `ReadOnlyAccess`.

### PKCE

Proof Key for Code Exchange: a step in browser sign-in that stops a stolen sign-in code from being used by anyone else.

### Plan and apply

OpenTofu's two steps: `plan` shows what would change, and `apply` changes it. You never run `apply`.

### pnpm

The package manager for the TypeScript packages. It also runs every package's scripts, such as `pnpm run check`.

### Presigned URL

A link, signed with the API's permission, that lets the browser upload one file straight to S3 for a few minutes.

### Prettier

The tool that formats code and Markdown the same way for everyone. `pnpm run format` fixes formatting; CI checks it.

### prevent_destroy

An OpenTofu setting that makes any plan to delete a resource fail. It guards data that can't be recovered.

### Pull request

A request to merge a branch into `main`, where the change is checked by CI and reviewed. Often called a PR.

### Pydantic

A Python library for data models that check their data. The generated contracts are Pydantic classes.

### RAG

Retrieval-augmented generation: giving an AI model relevant passages from documents, here the candidate's knowledge base, before it writes.

### Rebase

Moving your branch's commits on top of the newest `main`, so the history stays a straight line.

### Refresh token

A longer-lived token that the web app uses to get new access and ID tokens without asking the person to sign in again.

### Region

A geographic area with its own AWS data centres. CV Tailor uses `us-east-1` only ([ADR-0002](../adr/0002-aws-region.md)).

### Requirement ID

An ID such as `KB-06` or `SAFE-04` for one requirement in [`AGENTS.md`](../../AGENTS.md). Backlog items and code comments cite them.

### Runbook

Step-by-step instructions for an operations task, in [`docs/runbooks/`](../runbooks/README.md).

### S3

Amazon Simple Storage Service: stores files ("objects") in "buckets". Here: the web app's files, candidates' documents, and OpenTofu state.

### Scan

A DynamoDB read of every item in a table. You never run one.

### Scope

A permission named in an access token. The API requires `cv-tailor-api/user`.

### SCP

Service control policy: a rule in AWS Organizations that limits what any role in an account can do, such as using only `us-east-1`.

### SPA

Single-page application: a web app that loads once and then changes the page with JavaScript. The web app in `apps/web/` is one.

### Sprint

A one-week block of planned work, with a goal and a backlog. See [`docs/sprints/`](../sprints/README.md).

### SSM Parameter Store

An AWS service that keeps settings by name, such as the kill switch `/cv-tailor/ai-calls`.

### SSO

Single sign-on. Here, IAM Identity Center: one sign-in that gives short-lived access to AWS accounts ([account access runbook](../runbooks/account-access.md)).

### State

The file in which OpenTofu records what it has created, so it can compare it with the code. It's kept encrypted in S3.

### StrictMode

A React mode for development that runs effects twice, to show bugs early. See [07 Web](07-web.md).

### Stubber

botocore's test helper: it answers the AWS calls a test expects, and fails on any other call.

### Sub

A person's permanent user ID in Cognito, a lowercase UUID. The API knows people only by their `sub`.

### Typecheck

Running the TypeScript compiler (`tsc`) or mypy to find type mistakes without running the code.

### UUID v7

An ID format that starts with a timestamp, so IDs sort by when they were made ([ADR-0006](../adr/0006-data-store.md)).

### uv

The tool that installs Python and Python packages, and runs Python commands, for `services/agents/`.

### Vite

The tool that builds the web app and runs it on your computer (`pnpm --filter @cv-tailor/web dev`).

### Vitest

The test runner for the TypeScript packages.

### Workspace

A pnpm feature that lets several packages live in one repository and use each other. See [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml).

### Zod

A TypeScript library that describes data shapes and checks data at run time. The contracts are written with it.

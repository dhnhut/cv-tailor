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

### CloudFront

The AWS content delivery network that serves the web app's files to browsers.

### CloudTrail

The AWS service that records every API call made in an account: who did what, and when.

### Cognito

Amazon Cognito: the AWS service for sign-up and sign-in. It holds the users of CV Tailor (not of AWS) in a user pool.

### Commit

A saved set of changes in git, with a message. Here, every message starts with a sprint item ID, such as `S3-07`.

### Contract

The agreed shape of data that crosses a boundary, such as an API response. Written in Zod in `packages/contracts/` ([ADR-0003](../adr/0003-contracts-codegen.md)).

### CORS

Cross-origin resource sharing: the browser's rule about which websites may call an API on another address.

### Coverage

The share of code that tests run. Every package must stay at 80% or more, or CI fails.

### Dev container

A Docker container with every tool the project needs, defined in `.devcontainer/`. See [03 Setup](03-setup.md).

### DynamoDB

The AWS NoSQL database. CV Tailor stores its data in one table ([ADR-0006](../adr/0006-data-store.md)).

### Environment

A separate copy of the whole system: `dev` for development, `stag` for staging, and `prod` for real users. Each is in its own AWS account.

### esbuild

The tool that bundles each API Lambda function into one file (`pnpm --filter @cv-tailor/api build`).

### Generated file

A file a program writes, which you never edit by hand. `pnpm run generate` writes them. See [04 Repo tour](04-repo-tour.md#generated-files).

### GitHub Actions

GitHub's automation service. It runs the workflows in `.github/workflows/`.

### Golden rule

The product's first rule: the agent never invents a fact that isn't in the candidate's own documents ([`AGENTS.md`](../../AGENTS.md) §5.1).

### IAM

Identity and Access Management: the AWS service that decides who may do what. An **IAM role** is a set of permissions that a person, a service, or CI takes on for a short time.

### ID token

A token that describes the person who signed in, such as their email address. The web app reads it; the API never accepts it. See [Access token](#access-token).

### Infrastructure as code

Describing cloud resources in files that are reviewed, tested, and applied by a tool, instead of clicking in a console. Here, with OpenTofu in `infra/`.

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

### MFA

Multi-factor authentication: a second proof of identity, such as a code from an app, on top of a password.

### Monorepo

One repository that holds several packages. See [ADR-0001](../adr/0001-monorepo-pnpm-workspaces.md).

### MVP

Minimum viable product: the first release that is useful end to end ([ADR-0005](../adr/0005-mvp-scope.md)).

### OIDC

OpenID Connect: a standard way to prove an identity with a signed token. CI uses it to get short-lived AWS credentials without stored keys. Sign-in uses it too.

### OpenTofu

The infrastructure-as-code tool this project uses (`tofu`). See [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md).

### Permission set

In IAM Identity Center, a named set of permissions that a group gets in an AWS account, such as `ReadOnlyAccess`.

### PKCE

Proof Key for Code Exchange: a step in browser sign-in that stops a stolen sign-in code from being used by anyone else.

### pnpm

The package manager for the TypeScript packages. It also runs every package's scripts, such as `pnpm run check`.

### Prettier

The tool that formats code and Markdown the same way for everyone. `pnpm run format` fixes formatting; CI checks it.

### Pull request

A request to merge a branch into `main`, where the change is checked by CI and reviewed. Often called a PR.

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

### SCP

Service control policy: a rule in AWS Organizations that limits what any role in an account can do, such as using only `us-east-1`.

### SPA

Single-page application: a web app that loads once and then changes the page with JavaScript. The web app in `apps/web/` is one.

### Sprint

A one-week block of planned work, with a goal and a backlog. See [`docs/sprints/`](../sprints/README.md).

### SSO

Single sign-on. Here, IAM Identity Center: one sign-in that gives short-lived access to AWS accounts ([account access runbook](../runbooks/account-access.md)).

### State

The file in which OpenTofu records what it has created, so it can compare it with the code. It's kept encrypted in S3.

### Typecheck

Running the TypeScript compiler (`tsc`) or mypy to find type mistakes without running the code.

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

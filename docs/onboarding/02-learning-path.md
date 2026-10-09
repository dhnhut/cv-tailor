# 02 Learning Path

**Time:** about 45 hours, spread over four weeks · **Week:** 1 to 3 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `2e9e051`

## Goal

Learn each technology just well enough to read and change this project's code. This page is a list, not a module to finish in one go. Each module, and the [schedule](README.md#schedule), tells you which topic you need and when.

## How to learn a topic

- **Do, don't just read.** Type the tutorial's examples and change them.
- **Stop at "Ready when".** You don't need the whole book. When you can do the "Ready when" check, move on. You'll learn the rest from the code.
- **Use this repository as the exercise.** Every check points at real code here.
- **Ask your AI tutor** to explain a paragraph you don't understand, or to quiz you.

## Topics

### 1. The terminal and bash

- **Why we use it:** you run every command in this guide in a terminal.
- **Where in our repo:** everywhere; `scripts/*.sh` and `infra/scripts/*.sh` are bash scripts.
- **Learn:** [The Missing Semester: the shell](https://missing.csail.mit.edu/2020/course-shell/).
- **Ready when** you can move between folders, list files, read a command's exit code with `echo $?`, and search with `grep` and a pipe (`|`).
- **When:** day 1.

### 2. Git and GitHub

- **Why we use it:** every change is a commit on a branch, reviewed in a pull request.
- **Where in our repo:** the history (`git log`), and the branch and commit rules in [`docs/sprints/README.md`](../sprints/README.md#git-flow).
- **Learn:** [Pro Git, chapter 2](https://git-scm.com/book/en/v2/Git-Basics-Getting-a-Git-Repository) and [chapter 3](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell); [GitHub's Hello World](https://docs.github.com/en/get-started/start-your-journey/hello-world).
- **Ready when** you can create a branch, commit, see a diff, undo a change with `git restore`, and explain what a pull request and a rebase are.
- **When:** day 2. Rebasing matters in module 13.

### 3. HTTP, JSON, and CORS

- **Why we use it:** the web app talks to the API over HTTP and sends JSON.
- **Where in our repo:** `apps/web/src/api.ts` sends a request; `apps/api/src/handlers/http.ts` builds the responses.
- **Learn:** [MDN: an overview of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview); [HTTP status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status); [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
- **Ready when** you can explain a request's method, path, headers, and body, and what 200, 201, 204, 400, 401, 403, 404, 409, and 500 mean. You can say why a browser sends a "preflight" request.
- **When:** day 3.

### 4. TypeScript

- **Why we use it:** the web app, the API, the contracts, and the infra scripts are TypeScript.
- **Where in our repo:** `apps/`, `packages/`, `infra/scripts/`. The strict settings are in `packages/config/tsconfig/base.json`.
- **Learn:** [MDN: using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises) (for `async` and `await`); the TypeScript Handbook's [Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html) and [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
- **Ready when** you can explain the `Parsed` type in `apps/api/src/handlers/documents/request.ts`, and why, after `if (!parsed.ok)` in `create.ts`, TypeScript knows whether `parsed` has a `request` or a `code`.
- **When:** days 4 and 5.

### 5. Node.js and pnpm

- **Why we use it:** Node.js runs the TypeScript tools and the API's Lambda functions; pnpm installs packages and runs scripts.
- **Where in our repo:** each `package.json`, and [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml).
- **Learn:** [Introduction to Node.js](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs); [pnpm workspaces](https://pnpm.io/workspaces).
- **Ready when** you can explain what `pnpm --filter @cv-tailor/api test` runs, and where that script is defined.
- **When:** day 3, with module 04.

### 6. Testing with Vitest

- **Why we use it:** every TypeScript package has tests, and CI fails below 80% coverage.
- **Where in our repo:** the `test/` folder of each TypeScript package.
- **Learn:** [Vitest: getting started](https://vitest.dev/guide/); [Mocking](https://vitest.dev/guide/mocking.html).
- **Ready when** you can read `apps/api/test/data/profiles.test.ts` and say what each test checks, and run one test file on its own.
- **When:** day 5.

### 7. Zod

- **Why we use it:** Zod schemas describe every piece of data that crosses a boundary, and check it at run time.
- **Where in our repo:** `packages/contracts/src/`.
- **Learn:** [Zod basics](https://zod.dev/basics).
- **Ready when** you can explain the difference between `parse` and `safeParse`, and what `z.infer` gives you.
- **When:** day 6, before module 05.

### 8. AWS basics: Lambda and DynamoDB

- **Why we use it:** the API runs as Lambda functions, and its data is in one DynamoDB table.
- **Where in our repo:** `apps/api/src/handlers/` and `apps/api/src/data/`.
- **Learn:** [Lambda concepts](https://docs.aws.amazon.com/lambda/latest/dg/concepts-basics.html); [DynamoDB core components](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html).
- **Ready when** you can explain what a Lambda handler receives and returns, and what a partition key and a sort key are.
- **When:** day 7, before module 06.

### 9. React

- **Why we use it:** the web app is a React single-page app.
- **Where in our repo:** `apps/web/src/`.
- **Learn:** [react.dev: Learn](https://react.dev/learn), up to "Managing State"; [Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects).
- **Ready when** you can explain why the effect in `apps/web/src/pages/ProfilePage.tsx` sets `ignore = true` in its cleanup function.
- **When:** day 9, before module 07.

### 10. Sign-in: OAuth 2.0, PKCE, and JWT

- **Why we use it:** people sign in through Amazon Cognito, and the API checks the token the browser sends.
- **Where in our repo:** `apps/web/src/auth/`, and [ADR-0009](../adr/0009-sign-in-and-api-access.md).
- **Learn:** [PKCE explained](https://www.oauth.com/oauth2-servers/pkce/); [oauth.net: PKCE](https://oauth.net/2/pkce/); [Introduction to JSON Web Tokens](https://jwt.io/introduction).
- **Ready when** you can describe the sign-in round trip in five steps, and say what an access token, an ID token, and a refresh token are each for.
- **When:** day 9, before module 07.

### 11. Python, pytest, Pydantic, and uv

- **Why we use it:** the AI agent service is Python.
- **Where in our repo:** `services/agents/`.
- **Learn:** the [Python tutorial](https://docs.python.org/3.12/tutorial/), sections 3 to 9; pytest's [getting started](https://docs.pytest.org/en/stable/getting-started.html), [fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html), and [parametrize](https://docs.pytest.org/en/stable/how-to/parametrize.html); [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/); [uv: getting started](https://docs.astral.sh/uv/getting-started/).
- **Ready when** you can read the type hints in `services/agents/src/cv_tailor_agents/ai_guard/clients.py`, and explain what `@functools.cache` does to `default_kill_switch()`.
- **When:** days 11 and 12, before module 09.

### 12. Cloud basics

- **Why we use it:** everything runs on AWS, in separate accounts for `dev`, `stag`, and `prod`.
- **Where in our repo:** `infra/`, and [ADR-0004](../adr/0004-accounts-and-access.md).
- **Learn:** [AWS Cloud Practitioner Essentials](https://aws.amazon.com/training/digital/aws-cloud-practitioner-essentials/), a free course. The modules on compute, storage, databases, and security are enough.
- **Ready when** you can explain in one sentence each: an AWS account, a region, an IAM role, Lambda, API Gateway, DynamoDB, S3, CloudFront, and Cognito.
- **When:** day 13, before module 10.

### 13. Infrastructure as code with OpenTofu

- **Why we use it:** every AWS resource is described in code, reviewed, and tested.
- **Where in our repo:** `infra/`, and [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md).
- **Learn:** [OpenTofu: introduction](https://opentofu.org/docs/intro/); [the `tofu test` command](https://opentofu.org/docs/cli/commands/test/).
- **Ready when** you can explain what a resource, a module, a variable, an output, and state are, the difference between plan and apply, and what each `module` in `infra/stacks/workload/main.tf` builds, in one sentence each.
- **When:** day 13, before module 10.

### 14. CI/CD with GitHub Actions

- **Why we use it:** every pull request is checked by CI, and every merge to `main` is deployed to `dev`.
- **Where in our repo:** `.github/workflows/`.
- **Learn:** [Understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions).
- **Ready when** you can explain a workflow, a job, and a step, and why the `deploy-dev` job runs only on `main`.
- **When:** day 14, with module 11.

### 15. Dev containers

- **Why we use it:** everyone gets the same tools at the same versions.
- **Where in our repo:** `.devcontainer/`.
- **Learn:** [Developing inside a container](https://code.visualstudio.com/docs/devcontainers/containers).
- **Ready when** you can say what "Reopen in Container" does, and when `postCreate.sh` runs.
- **When:** day 2, with [03 Setup](03-setup.md).

## Verify

For each topic you've reached in the schedule, you can do its "Ready when" check without help.

## If you get stuck

- A tutorial is too hard: tell your mentor. There may be an easier one, or you may need only one part of it.
- A tutorial disagrees with this repository: the repository wins. Projects choose conventions, and this one records its choices in ADRs.

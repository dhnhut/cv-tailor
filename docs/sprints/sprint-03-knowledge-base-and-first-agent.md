# Sprint 3: Knowledge Base and First Agent

**Sprint goal:** A candidate uploads documents to their own knowledge base at `dev.cv.ikiwii.com` and sees them indexed. They can also submit a job description as text and get a structured analysis back from the first agent, which runs on AgentCore Runtime behind the kill switch.

**Dates:** 2026-10-08 to 2026-10-14

**Status:** Planned

## Scope

- The decisions Sprint 3 needs, made first: the async generation mechanism (D-07), the ID format for documents and jobs (D-13), the model per task (D-09), and the evaluation benchmark design (D-10)
- The knowledge base: a documents bucket, the managed knowledge base with ACLs ([ADR-0007](../adr/0007-knowledge-base-store.md)), presigned upload, the 50 MB storage cap, ingestion sync, document status, and a page to manage documents (KB-01, KB-03, KB-04, KB-05, KB-06)
- The agent service on AgentCore Runtime, deployed by CI
- A first JD Analyzer on a JD given as text, run end to end as an async job: API, AgentCore, job status, and a web page (GEN-01 text, GEN-04, SAFE-01)
- The API's own kill switch check, on the first endpoint that starts AI work (S2-11)
- The infrastructure moved from AWS CDK to OpenTofu, before the items that add infrastructure (S3-15, [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md))

This is slice C of [ADR-0005](../adr/0005-mvp-scope.md), plus the first agent from slice D. A candidate creates Markdown content (KB-01) by uploading `.md` files. An in-app editor is not planned.

---

## Target Picture

```text
Browser (dev.cv.ikiwii.com)
├─ /documents ── POST /documents ──▶ API Lambda ──▶ DynamoDB (KbDocument, storage reservation)
│     │                                  └─ writes the ACL file (<file>.metadata.json) to S3
│     └─ presigned upload ────────────────────────▶ S3 documents bucket
│                                                   └─ event ─▶ sync Lambda ─▶ StartIngestionJob
│                                                                               └─▶ managed knowledge base
└─ /analyze   ── POST /jobs ──▶ API Lambda (admin only, kill switch) ──▶ GenerationJob: QUEUED
                                   └─ ADR-0010 mechanism ─▶ AgentCore Runtime: JD Analyzer
                                                              ├─▶ Bedrock Converse (AI call guard)
                                                              └─▶ GenerationJob: DONE + result
              ── GET /jobs/{id} (poll) ◀──────────────────────────┘
```

S3-15 turns each CDK stage into an OpenTofu stack with its own state ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md)). Stages are named as before S3-15, and stacks as after it.

| Stage → stack                 | Deployed by | Holds after this sprint                                                                                                                                                              |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (new) → `bootstrap`           | Laptop      | The state bucket and the KMS key for state encryption (S3-15)                                                                                                                        |
| `<env>-access` → `access`     | Laptop      | The OIDC provider and `GithubDeployRole`, which now has direct, scoped permissions, and the workload permissions boundary (S3-15)                                                    |
| `<env>-baseline` → `baseline` | Laptop      | Unchanged resources. An apply can no longer reset the kill switch (S3-15).                                                                                                           |
| `<env>-dns` → `dns`           | Laptop      | Unchanged resources. The hosted zones are imported, not recreated (S3-15).                                                                                                           |
| `<env>` → `workload`          | CI          | Adds the knowledge base (bucket, knowledge base, data source, sync Lambda), the AgentCore Runtime and its role, and new API routes. Module names are set in S3-06, S3-10, and S3-15. |

---

## Backlog

| ID    | Item                                  | Requirement IDs            | Acceptance criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3-01 | Sprint doc                            | —                          | This doc is merged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S3-02 | ADR-0010: async generation            | GEN-04                     | `docs/adr/0010-async-generation.md` settles every point in [S3-02 details](#s3-02-details-what-adr-0010-settles), with sources for any AgentCore behaviour it relies on. Status is "Accepted" by day 2 of the sprint. `AGENTS.md` §7 is updated.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S3-03 | ID format for documents and jobs      | §7                         | ADR-0006 is amended with one ID format for knowledge base documents and generation jobs, and the reason. The `ID` pattern in `apps/api/src/data/keys.ts` accepts only that format, and its tests cover a valid ID and the shapes it now refuses.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S3-04 | ADR-0011: model per task              | QUOTA-01                   | `docs/adr/0011-model-per-task.md` splits the USD 0.10 per generation budget across the agents in `AGENTS.md` §5.3, using current Bedrock prices with sources. It chooses the JD Analyzer's model from S3-11's measured cost and benchmark scores, and gives provisional models for the other agents, which Sprint 4 confirms. It records how prompt caching is used. Status is "Accepted" before S3-11 closes.                                                                                                                                                                                                                                                                     |
| S3-05 | ADR-0012: evaluation benchmark design | SAFE-03                    | `docs/adr/0012-evaluation-benchmark.md` settles every point in [S3-05 details](#s3-05-details-what-adr-0012-settles). Status is "Accepted" before S3-11 closes. `services/agents/evals/README.md` describes the dataset format and how to run the benchmark.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| S3-06 | Knowledge base stack                  | KB-05                      | The workload stage has a knowledge base stack: a private documents bucket, the managed knowledge base, and an S3 data source with ACLs on, a 50 MB file size filter, and a recorded decision on image extraction. The bucket holds user data, so it has the same guards against replacement and deletion as the data table (S2-08). The knowledge base ID, data source ID, and bucket name are in SSM. A test pins `connectorParameters`. `infra/spikes/`, its test, and `kb_spike_check.py` are deleted.                                                                                                                                                                          |
| S3-07 | Document API                          | KB-01, KB-03, KB-04, KB-06 | `POST /documents`, `GET /documents`, and `DELETE /documents/{id}` work as [S3-07 details](#s3-07-details-upload-and-delete) describe. The API writes each document's ACL file, never the browser. The 50 MB total holds under concurrent uploads. An upload whose content hash matches the stored one is skipped. Contracts are in `packages/contracts`. The Lambda's IAM policy allows only the actions it uses, which an exact-match test checks. Tests cover: user A can't list or delete user B's documents, a wrong type or size is refused, and the cap refuses one byte over 50 MB.                                                                                         |
| S3-08 | Ingestion sync and document status    | KB-05                      | An upload or a delete starts an ingestion sync, and two syncs that collide are handled, as [S3-08 details](#s3-08-details-sync-and-status) describe. `GET /documents` shows each document's status (`PENDING`, `INDEXED`, or `FAILED`). A CloudWatch alarm fires when an ingestion job reports failed documents. Checked live: an uploaded file reaches `INDEXED`, and a deleted one leaves the knowledge base.                                                                                                                                                                                                                                                                    |
| S3-09 | Knowledge base page                   | KB-01, KB-03               | A signed-in candidate uploads, lists, and deletes documents on a `/documents` page, and sees each document's status and their usage against 50 MB. Type and size are checked before upload. Tests cover each state. Checked live on `dev.cv.ikiwii.com` with a `.md` and a `.pdf` file.                                                                                                                                                                                                                                                                                                                                                                                            |
| S3-10 | Agents on AgentCore Runtime           | ADMIN-03, KB-05            | CI deploys `services/agents` to an AgentCore Runtime in `dev`, built before AWS credentials exist. The runtime role allows only the actions in [S3-10 details](#s3-10-details-the-agent-runtime), which an exact-match test checks. `clients.py` gains a Retrieve client behind the kill switch, and one function builds the ACL identity from the `sub`. Checked live: the runtime answers a health request, and a Retrieve for user A never returns user B's document.                                                                                                                                                                                                           |
| S3-11 | JD Analyzer                           | GEN-01, SAFE-01, SAFE-04   | A LangGraph agent turns a JD given as text into a `JdAnalysis`, a contract in `packages/contracts` with a generated Pydantic model (ADR-0003). Every model call goes through the AI call guard, and the boundary test still passes. The JD is handled as untrusted data, and tests include JDs with hidden instructions. Log lines hold no JD text. The JD Analyzer benchmark from ADR-0012 passes its thresholds, and the scores and cost per call are recorded in the sprint review.                                                                                                                                                                                             |
| S3-12 | Generation job API                    | GEN-01, GEN-04, ADMIN-03   | `POST /jobs`, `GET /jobs/{id}`, and `GET /jobs` work as [S3-12 details](#s3-12-details-the-job-api) describe. `POST /jobs` checks the kill switch itself before it starts any work, and only the `admin` group may call it until the quota exists (Sprint 6). Tests cover the kill switch states, a non-admin caller, a JD that is too long, and user A reading user B's job. Checked live: a job returns a result, a disabled switch returns `503` within 30 seconds, and a non-admin gets `403`.                                                                                                                                                                                 |
| S3-13 | JD analysis page                      | GEN-01                     | A signed-in admin pastes a JD on an `/analyze` page, submits it, and sees the analysis when the job finishes. The page shows clear states for "AI is paused", "not allowed", failed, and timed out. Tests cover each state. Checked live end to end on `dev.cv.ikiwii.com`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| S3-14 | Close the sprint                      | DoD                        | The sprint review is filled in, and every backlog ID has a "Done" or "Not done" entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| S3-15 | Infrastructure on OpenTofu            | §7, §8, §10                | `infra/` is OpenTofu as [ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md) describes, and holds no CDK code. ADR-0013 is "Accepted". `pnpm run check` runs `tofu fmt`, `tflint`, `tofu test` for every module and stack, and `tofu validate`, and CI runs `trivy config`. Exact-match tests pin `GithubDeployRole`'s policy, the permissions boundary, and every workload role's actions. CI deploys `dev` with OpenTofu, as [S3-15 details](#s3-15-details-the-move-to-opentofu) describe. Checked live: the zones keep their name servers, the S2-04 to S3-07 live checks pass again, the state in S3 is ciphertext, and no CloudFormation stack is left in any account. |

### S3-02 details: what ADR-0010 settles

1. **The mechanism.** Options to compare:
   - (a) The API calls `InvokeAgentRuntime`, and the agent answers at once and continues the job in the background, using AgentCore Runtime's support for long-running work.
   - (b) The API sends an SQS message, and a worker Lambda calls the runtime and waits. Lambda's 15-minute limit then bounds a job.
   - (c) A Step Functions state machine runs the job and calls the runtime.
2. **How results reach the web app:** polling `GET /jobs/{id}`, a WebSocket, or streaming, and the cost of each.
3. **Who writes the job item.** ADR-0006 says one module, in TypeScript, builds every key. The ADR chooses between a Python writer in the agent, kept identical to the TypeScript keys by a shared test or contract, and returning the result to a TypeScript writer.
4. **Job states** (`QUEUED`, `RUNNING`, `DONE`, `FAILED`), the longest a job may run, how a stuck job becomes `FAILED`, and whether finished jobs expire through TTL.
5. **Retries and idempotency:** a retried start never runs the agent twice.
6. **How the API calls the runtime and is authorised,** and the session ID for each job.
7. **Cost** at low volume: fixed and per job.

### S3-03 details: the ID format

- The current leaning is a time-ordered ID (UUID v7 or ULID): with `SK = JOB#<id>`, a query with `ScanIndexForward: false` lists a user's jobs newest first, with no index.
- Check whether Node 24 can generate a UUID v7 without a dependency before adding one.
- Only the API creates IDs, so only TypeScript needs a generator.

### S3-05 details: what ADR-0012 settles

1. **Dataset:** synthetic candidates and JDs only, never real personal data. Where it lives (`services/agents/evals/`) and its versioned format.
2. **Metrics for each agent.** JD Analyzer: requirement recall and precision against hand-labelled JDs, schema validity, and cost and latency per call. Writers and Reviewer (Sprint 4): fabrication rate (every claim traces back to a source document), JD coverage, and style match.
3. **Pass thresholds** for each metric.
4. **The runner:** our own runner, or AgentCore Evaluations, compared on cost, effort, and where results are kept.
5. **When it runs:** on demand in Sprint 3, and as a CI gate from Sprint 4, with a cost cap for each run.

### S3-06 details: the knowledge base stack

- It reuses the spike's knowledge base, data source, and service role (`infra/spikes/kb-spike-stack.ts`), with these changes from the S2-12 review notes:
  - the data source sets `filterConfiguration.maxFileSizeInMegaBytes` to `"50"`;
  - image extraction is turned off, unless the item finds a reason to keep it. Images aren't an allowed upload type, and the service turns it on by default.
- **Bucket:** private, encrypted, SSL only. CORS allows uploads from `https://<host>` only. It has a retain policy and a fixed name, and its stack has termination protection.
- The API and the runtime read the IDs from SSM, as other stacks read the user pool ID.

### S3-07 details: upload and delete

1. `POST /documents` with `{ name, type, size, sha256 }`:
   - checks the type (`.txt`, `.md`, `.html`, `.doc`, `.docx`, `.pdf`) and the size (50 MB at most);
   - skips the upload when the same hash is already stored for this user, because overwriting an unchanged file re-indexes it (S2-12);
   - reserves the bytes against the 50 MB total with a conditional update, so two uploads at once can't pass the cap;
   - creates the `KbDocument` item, writes the ACL file for `<sub>@users.cv-tailor.invalid`, and returns a presigned upload.
2. The item chooses a presigned POST, whose policy fixes the key and the size range, or a presigned PUT with a signed length and checksum, and records why.
3. A reservation whose upload never arrives is released. The item chooses how.
4. `GET /documents` lists the caller's documents and their status (S3-08).
5. `DELETE /documents/{id}` removes the document, its ACL file, and its item, frees its bytes, and starts a sync.
6. The ACL identity is built by one function. S3-10's Python function must build the same string, which a test checks.
7. The Vite dev server gets a proxy entry for each new path (S2-10).

### S3-08 details: sync and status

- An S3 event for a document, not its ACL file, triggers a small Lambda that starts an ingestion job.
- Before choosing how to handle collisions, the item checks AWS's limits on concurrent ingestion jobs per data source and per knowledge base. A collision is retried with backoff, or events are batched through SQS. The item records the choice.
- Status comes from `ListKnowledgeBaseDocuments`, mapped from `s3://<bucket>/<key>` back to the document ID (S2-12).
- The alarm reads each ingestion job's failed-document count. It is a signal only: ingestion doesn't name a document it drops (S2-12).

### S3-10 details: the agent runtime

- **Packaging:** container image or direct code deploy. The item compares them and records the choice. Either way, the build runs before AWS credentials in `deploy.yml`, as the web app and API builds do. Direct code deploy is preferred if it supports the package's dependencies, because CI then needs no Docker.
- **Runtime role**, from the S2-11 and S2-12 review notes:
  - `ssm:GetParameter` on `/cv-tailor/ai-calls`;
  - model invocation for ADR-0011's models only;
  - `bedrock:Retrieve` on the knowledge base;
  - only the table actions ADR-0010 needs.
- **Retrieve client:** `clients.py` gains a `bedrock-agent-runtime` client. Its guard allows only `Retrieve`, refuses a call without `userContext`, and checks the kill switch. The boundary test covers the new service.
- **Observability:** logs and traces are on, with a set log retention.

### S3-12 details: the job API

1. `POST /jobs` with `{ jd }`:
   - refuses a caller outside the `admin` group with `403`;
   - refuses a JD longer than a set limit, which leaves room for the prompt within the guard's 100,000-byte input cap;
   - checks the kill switch, and returns `503` with a stable "AI is paused" code when it is off;
   - creates the `GenerationJob` item (`QUEUED`), starts the work as ADR-0010 decides, and returns `202` with the job ID.
2. `GET /jobs/{id}` returns the status and, when the job is `DONE`, its `JdAnalysis`. Another user's job returns `404`.
3. `GET /jobs` lists the caller's jobs, newest first.
4. **The kill switch check** follows the S2-11 rules: only `enabled` allows work; a missing parameter or a read error blocks it and isn't cached; a good value is cached for 30 seconds. An infra test checks that the API and the guard name the same parameter.
5. **Why the API checks the switch** when the guard already checks every model call:
   - Without it, a job is written and the runtime is invoked, and AgentCore bills for its active time, before the guard refuses the first model call. ADMIN-03 turns off all AI calls, and invoking the runtime is one.
   - The candidate sees "AI is paused" at once, not a job that fails a few polls later.
   - Two independent checks: a bug in one still leaves the other. The guard remains the final check, and it also stops jobs already running when the switch turns off.

### S3-15 details: the move to OpenTofu

1. **Why now:** S3-08, S3-10, and S3-12 add infrastructure. Converting first means they are written once, in HCL.
2. **Same resources, same settings:** names, user pool settings, IAM actions, CORS, the CSP, cache rules, and the guards on data stores carry over as they are. What changes is listed in ADR-0013: the deploy role, state, SSM parameters between stacks, the web upload, and the kill switch's `ignore_changes`.
3. **Commits**, each reviewed before the next:
   1. ADR-0013, this item, and the `AGENTS.md` changes.
   2. Tooling: the devcontainer, `infra/package.json`, `tofu.sh`, `tflint`, and the CI `check` job, while CDK stays in place.
   3. The `bootstrap`, `access`, and `baseline` stacks, with tests.
   4. The `dns` stack, with tests.
   5. The `workload` modules, the generated `contracts.json`, and `web-config.ts`, with tests.
   6. `deploy.yml` switched to OpenTofu. CDK removed. Runbooks, ADR amendment notes, and the emergency-deny SCP updated.
   7. The move on AWS, then the live checks and the merge.
4. **The move on AWS** follows ADR-0013 point 10 and the deploy runbook. Merges to `main` are frozen until it's done. The `dev` workload is recreated, so its test users and documents are lost. Only the two hosted zones are imported.
5. **The deploy role** is checked with `aws iam simulate-principal-policy` after the `access` apply: budgets, hosted zone deletion, the kill switch, and a role without the boundary are all denied.

---

## Execution Guide (step by step)

See the owner legend in [README.md](README.md#owner-legend). Every step follows the [git flow](README.md#git-flow).

| #   | Step                    | Item  | Owner                          | How                                                                                                                                                                 | Verify                                                                                                                                                                                     |
| --- | ----------------------- | ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Save the sprint doc     | S3-01 | Claude                         | Write this file.                                                                                                                                                    | I read and approve it.                                                                                                                                                                     |
| 2   | Decide the async design | S3-02 | Claude drafts, **Me** decides  | Claude drafts ADR-0010 with the options in the S3-02 details, checked against the current AgentCore documentation.                                                  | ADR status is "Accepted" by day 2.                                                                                                                                                         |
| 3   | Decide the ID format    | S3-03 | Claude drafts, **Me** decides  | Claude checks Node 24's UUID support, proposes the format, and gives the ADR-0006 amendment and the `keys.ts` change with tests.                                    | `pnpm --filter @cv-tailor/api test` passes.                                                                                                                                                |
| 4   | Knowledge base stack    | S3-06 | Me + Claude                    | Claude gives the stack, its test, and the removal of the spike files. It runs in parallel with steps 2 and 3.                                                       | After the merge, the `main` run is green. `aws bedrock-agent get-data-source --profile cvt-dev …` shows ACLs on and the 50 MB filter.                                                      |
| 5   | Document API            | S3-07 | Me + Claude                    | Claude gives the handlers, contracts, IAM policy, routes, and tests.                                                                                                | `curl` with an admin token uploads a file. The document and its ACL file are in S3. The same file again returns "unchanged".                                                               |
| 6   | Move to OpenTofu        | S3-15 | Claude drafts, **Me** decides  | Claude drafts ADR-0013 and gives each commit in [S3-15 details](#s3-15-details-the-move-to-opentofu). I run the move on AWS from my laptop with the deploy runbook. | `pnpm run check` passes. Every `tofu.sh <env> <stack> plan` shows no changes. The S2-04 to S3-07 live checks pass on `dev.cv.ikiwii.com`. The first CI deploy is green.                    |
| 7   | Sync and status         | S3-08 | Me + Claude                    | Claude gives the sync Lambda, the status mapping, the alarm, and tests.                                                                                             | The uploaded file shows `INDEXED` in `GET /documents`. After a delete, `list-knowledge-base-documents` no longer lists it.                                                                 |
| 8   | Knowledge base page     | S3-09 | Me + Claude                    | Claude gives the page, the content security policy change, and tests.                                                                                               | On `dev.cv.ikiwii.com`, I upload a `.md` and a `.pdf`, see both indexed, delete one, and see my usage drop.                                                                                |
| 9   | Model per task          | S3-04 | Claude drafts, **Me** decides  | Claude drafts ADR-0011 with current prices. The JD Analyzer's choice is filled in from step 12's numbers.                                                           | ADR status is "Accepted".                                                                                                                                                                  |
| 10  | Evaluation benchmark    | S3-05 | Claude drafts, **Me** decides  | Claude drafts ADR-0012 and the dataset format. I review the labelled JDs.                                                                                           | ADR status is "Accepted".                                                                                                                                                                  |
| 11  | Agent runtime           | S3-10 | Me + Claude                    | Claude gives the agents module, the packaging step in `deploy.yml`, the Retrieve client, and tests. It starts after steps 2 and 6.                                  | A check script gets a health answer from the runtime. A Retrieve as user A returns only A's documents.                                                                                     |
| 12  | JD Analyzer             | S3-11 | Me + Claude                    | Claude gives the contract, the agent, its tests, and the benchmark runner. I run the benchmark.                                                                     | Tests pass. The benchmark meets ADR-0012's thresholds. A call through the runtime returns a valid `JdAnalysis`.                                                                            |
| 13  | Job API                 | S3-12 | Me + Claude                    | Claude gives the handlers, the TypeScript kill switch check, contracts, IAM policy, routes, and tests.                                                              | `POST /jobs` returns `202`, and `GET /jobs/{id}` later shows `DONE` with a result. With the switch `disabled`, `POST /jobs` returns `503` within 30 seconds. A non-admin token gets `403`. |
| 14  | JD analysis page        | S3-13 | Me + Claude                    | Claude gives the page and tests.                                                                                                                                    | On `dev.cv.ikiwii.com`, I paste a JD and see the analysis. With the switch off, I see "AI is paused".                                                                                      |
| 15  | Close the sprint        | DoD   | Claude drafts, **Me** approves | Fill in the sprint review, and list any backlog ID without a "Done" or "Not done" entry.                                                                            | The sprint review below is complete.                                                                                                                                                       |

Steps 2, 3, and 4 run in parallel on day 1. Step 6 (OpenTofu) follows step 5, and every later step that changes infrastructure (7, 11, and 13) waits for it. Step 8's page and steps 9 and 10's ADR drafts don't wait. Step 11 starts as soon as ADR-0010 is accepted and step 6 is merged.

---

## Out of Scope (current sprint)

- The Profile Matcher, the writers, the Style Agent, the Reviewer, and Bedrock Guardrails (Sprints 4 and 5)
- The evaluation benchmark as a CI gate (Sprint 4)
- Quota counters and checks (Sprint 6). Until then, AI and upload endpoints are for the `admin` group only.
- An in-app Markdown editor. Markdown content is uploaded as `.md` files.
- A JD from a link or a file (Sprint 5)
- Workloads in `stag` and `prod`
- An OpenTofu plan on every PR with a read-only role (ADR-0013, when to revisit)
- AgentCore Memory, Gateway, Policy, and Browser
- Deleting a candidate's knowledge base data when their account is deleted. It belongs to the account deletion item, which isn't planned yet.

## Risks

| Risk                                                                                                                                                           | Mitigation                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Anyone can sign up in `dev`, and the quota comes in Sprint 6, so a script could call `POST /jobs` or upload files in a loop. The budget alarm isn't real time. | `POST /jobs` and `POST /documents` accept the `admin` group only until the quota exists. The API already knows the caller's group (S2-09).   |
| ADR-0010 is decided late, which blocks steps 10 to 13.                                                                                                         | It is due by day 2. The knowledge base steps run meanwhile.                                                                                  |
| Packaging and deploying to AgentCore Runtime from CI is new.                                                                                                   | Step 10 starts right after ADR-0010. Direct code deploy is preferred, so CI needs no Docker.                                                 |
| Ingestion jobs collide, or a sync is slow.                                                                                                                     | S3-08 handles collisions, and the page shows each document's status.                                                                         |
| `infra/test/bin.test.ts` times out more often with two more stacks (S2-13 lesson).                                                                             | If it fails in CI, it gets its own step. S3-15 removes the test with CDK.                                                                    |
| The sprint runs over: 15 items, one more than Sprint 2, and S3-15 is large.                                                                                    | S3-09 moves first. The document API is checked with `curl`, and Sprint 4 needs knowledge base data, not the page.                            |
| S3-15 delays the items that add infrastructure (S3-08, S3-10, S3-12).                                                                                          | The ADR drafts (S3-04, S3-05) and the agent code (S3-11) don't wait for it. S3-15 lands in seven reviewed commits, so a problem shows early. |
| During the move on AWS, `dev` is down, and CI can't deploy.                                                                                                    | Merges to `main` are frozen. The deploy runbook gives the order. `dev` holds test data only.                                                 |
| `GithubDeployRole` gets direct permissions, which are broader than the CDK hand-off (ADR-0013 point 5).                                                        | A permissions boundary on every workload role, explicit denies, exact-match tests, and a policy simulator check after each `access` apply.   |
| New costs.                                                                                                                                                     | Knowledge base storage, Retrieve calls, runtime active time, and model calls are all pay per use. Each item notes any fixed cost.            |

## Definition of Done (Sprint 3)

- All S3 items are merged to `main` through PRs with green CI.
- After every merge, `gh run list --branch main --limit 1` shows the `main` run green, including `deploy-dev`.
- An item that connects two systems (upload and sync, API and runtime, page and API) closes only after a real run on `dev.cv.ikiwii.com` succeeds.
- Each item's PR adds its "Done" entry to the sprint review.
- ADR-0010, ADR-0011, ADR-0012, and ADR-0013 are accepted, ADR-0006 is amended, and `AGENTS.md` is updated.
- The sprint review is filled in.

## Verification

1. A `.md` and a `.pdf` uploaded on `dev.cv.ikiwii.com` reach `INDEXED`.
2. User A can't list, delete, or retrieve user B's documents.
3. An upload that would pass 50 MB in total is refused.
4. On `/analyze`, a pasted JD returns a structured analysis.
5. With `/cv-tailor/ai-calls` set to `disabled`, `POST /jobs` returns `503` within 30 seconds, and the agent's guard refuses model calls.
6. A user outside the `admin` group gets `403` from `POST /jobs` and `POST /documents`.
7. The JD Analyzer benchmark meets ADR-0012's thresholds, and its cost per call is recorded.
8. ADR-0010, ADR-0011, and ADR-0012 are accepted, and ADR-0006 records the ID format.
9. `infra/` holds no CDK code, CI deploys `dev` with OpenTofu, no CloudFormation stack is left in any account, and ADR-0013 is accepted.

---

## Sprint Review

- **Done:**
  - S3-06: `<env>-KnowledgeBase` holds the documents bucket `cv-tailor-<env>-documents-<account>`, the managed knowledge base `cv-tailor-<env>-kb`, and its S3 data source `documents`. The bucket is private (public access blocked, object ACLs off), encrypted with S3-managed keys, and SSL only. CORS allows uploads from `https://<host>` only. The bucket has the data table's guards: a retain policy, a fixed name and logical ID (`DocumentsBucket`), versioning with old versions expiring after 35 days, a bucket policy that denies `s3:DeleteBucket` to everyone, and termination protection on the stack. The data source has ACLs on, a 50 MB file size filter, image, audio, and video extraction off, deletion protection off, and the default chunking ([ADR-0007](../adr/0007-knowledge-base-store.md), "Ingestion settings"). The service role may only list the bucket and read its objects. The knowledge base ID, data source ID, and bucket name are in SSM under `/cv-tailor/knowledge-base/`. A test pins the whole data source with `objectEquals`, `connectorParameters` included, and another lists every resource the stack holds. `infra/spikes/`, its test, and `kb_spike_check.py` are deleted. Checked live on 2026-10-06 after `deploy-dev`: the data source is `AVAILABLE`, its `connectorParameters` hold `aclEnabled: true` and the 50 MB filter, image, audio, and video extraction and deletion protection are `DISABLED`, and the service added no defaults, unlike in S2-12. The bucket has versioning, CORS for `https://dev.cv.ikiwii.com` only, the SSL and `DeleteBucket` denies, and the 35-day lifecycle rule. `dev-KnowledgeBase` has termination protection.
  - S3-07: `POST /documents`, `GET /documents`, and `DELETE /documents/{id}` run on `api.<host>`, each in its own Lambda (`CreateDocument`, `ListDocuments`, `DeleteDocument`). `POST` is for the `admin` group only until the quota exists. It reserves the bytes and writes the `KbDocument` item in one `TransactWriteItems`, whose condition refuses a total over 50,000,000 bytes or 100 documents. It then writes the ACL file and returns a presigned PUT that signs the size, the content type, and the SHA-256. An upload whose hash matches one of the same user's stored documents returns `unchanged`, and a retry of a file still uploading returns `resumed`. A reservation whose file hasn't arrived an hour later is released by the user's next `POST` or `GET`. `DELETE` removes the document, its ACL file, and its item, and frees the bytes. The contracts are in `packages/contracts` (`documents.ts`, `api-error.ts`), and the ACL identity is built by one function, tested against a fixture that S3-10's Python test will share. Each Lambda's IAM policy holds only the calls its code makes, which an exact-match test checks per function. The bucket's CORS allows `PUT` only, and the Vite dev server proxies `/documents`. 424 API tests at 98.5% line coverage, 106 contract tests, and 196 infra tests. Checked live on 2026-10-07 after `deploy-dev`, with an admin and a second, non-admin account. Without a token, all three routes return `401` with the CORS header, and the preflight allows `GET,POST,DELETE` from `https://dev.cv.ikiwii.com` only. The bucket's preflight allows `PUT` and refuses `POST` and other origins. The deployed functions and their IAM policies match the tests statement for statement. The non-admin got `403 forbidden` from `POST`, an empty list from `GET`, and `404` when deleting the admin's document, which stayed in S3. An upload returned `201`, and its ACL file, with one `ALLOW` entry for `<sub>@users.cv-tailor.invalid`, was in S3 before the document. With the same URL, a body one byte longer got `403 SignatureDoesNotMatch`, a body of the same size with other bytes got `400 BadDigest`, and the declared file got `200`. The next `GET` showed the document as `PENDING` and marked its item `UPLOADED`. The same content again, also under another name, returned `unchanged`. A wrong type, a size of 50,000,001, a name that doesn't match the type, a body that isn't JSON, a bad hash, and a missing type each got `400` with their codes, and wrote nothing. A document still uploading got `409 upload-in-progress`, and `204` once uploaded. A delete removed both files and the item and freed the bytes, a second delete got `404`, and the old versions stayed behind delete markers. A retry without an upload returned `resumed` with the same ID and a new URL, and was counted once. Six 9,000,000-byte reservations sent at once gave five `created` and one `storage-full`, one byte over the remaining room got `409 storage-full`, and the exact remainder filled the cap to 50,000,000. Before the deadline, a `GET` released nothing. One minute after it, a `GET` released all six reservations: their ACL files and items were deleted, and the usage went back to 48 bytes. The logs hold only the route, the outcome, the duration, and a document count: no `sub`, file name, document ID, ACL identity, or URL, and no errors. Cold starts took 300–410 ms to initialise and 230–750 ms for the first request, and warm requests took a median of about 65 ms.
  - S3-15: the infrastructure is OpenTofu ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md)), and `infra/` holds no CDK code. Each account has five stacks, each with its own state in `cv-tailor-tfstate-<account>`: `bootstrap` (the state bucket and its KMS key), `access` (the GitHub OIDC provider, `GithubDeployRole`, and the workload permissions boundary), `baseline`, `dns`, and `workload`. Committed settings live in `modules/settings`, and `infra/scripts/tofu.sh` runs one environment and one stack at a time. State and plans are encrypted with the account's KMS key before they're written, so the Google client secret in state is ciphertext. `GithubDeployRole` changes the workload directly, limited to `cv-tailor-<env>-*` names, with a boundary on every role it creates and explicit denies on its own access, the budget, the kill switch, the hosted zones, other stacks' state, user data, invoking functions, and model calls. The kill switch's committed value is used only when the parameter is created, so an apply never resets it. CI checks `tofu fmt`, `tflint`, `trivy`, `tofu validate`, and 36 `tofu test` runs, and deploys `dev` with a saved, encrypted plan and `infra/scripts/deploy-web.sh`. The two hosted zones were imported, and every other resource was created again, so `dev`'s test users and documents were lost. Checked on 2026-10-08: no CloudFormation stack or CDK leftover in any account; a plan of every stack in every account showed no change other than this item's own; the `dev` workload state holds no plain text; a destroy plan is refused for the user pool, the data table, and the documents bucket; `GithubDeployRole` is denied the budget and allowed `acm:GetCertificate`; `dev.cv.ikiwii.com` kept its four name servers; the new certificate covers `dev.cv.ikiwii.com` and `*.dev.cv.ikiwii.com`; the site sends HSTS, the CSP, and the other headers, serves app routes and `config.json`, and caches assets for a year; the API returns `401` without a token and `403` for an unknown route, each with the CORS header for the web origin only, and its preflight is unchanged; managed login loads, and refuses an unknown redirect URL; and neither OpenTofu deploy log contains the Google client secret.
- **Not done / carried over:**
  - S3-15: the live sign-in and document checks (password and Google sign-in, `GET /me` with a token, and the S3-07 upload, list, and delete), after the `dev` users are created again (deploy runbook, step 7.6). The admin group was still empty on 2026-10-08.
- **What changed and why:**
  - S3-06: the bucket name ends with the account ID. Bucket names are global, so a guessable name such as `cv-tailor-prod-documents` could be taken by another account first and block the deploy. AWS doesn't treat account IDs as secret, and they still aren't committed: the name is built at synth (ADR-0004 §2).
  - S3-06: S3 has no PITR or deletion protection, so versioning and a bucket policy that denies `s3:DeleteBucket` play those parts. Old versions expire after 35 days, the PITR window, so a deleted document can be restored for 35 days and is gone after that.
  - S3-06: the bucket uses S3-managed keys, not a customer-managed KMS key. A KMS key has a fixed cost (USD 1 per month) and needs a key policy for the knowledge base role, and it adds no protection this threat model needs.
  - S3-06: deletion protection on the data source is turned off. The S3-06 details didn't mention it; reading the connector reference found it. With it on, a sync skips its delete phase when it would remove more than 15% of the index. One knowledge base serves every candidate, so while the index is small, one candidate's delete can pass 15%, and the deleted document would stay retrievable.
  - S3-06: image extraction is off, as the S3-06 details proposed, and audio and video extraction are off too. Setting all three means a change in the service's defaults can't change what is indexed.
  - S3-06: CORS allows both `POST` and `PUT` until S3-07 chooses between a presigned POST and a presigned PUT. S3-07 removes the method it doesn't use.
  - S3-06: the AgentCore CLI (`aws/agentcore-cli` 0.31.1) was considered for the knowledge base. Its S3 data source takes only a bucket URI, so it can't turn ACLs on, set the size filter, or turn media extraction off, and it doesn't create the bucket. Its CDK library is an alpha (`@aws/agentcore-cdk` 0.1.0-alpha.54). S3-10 compares it as a way to deploy the agent runtime.
  - S3-06: for S3-08:
    - the AgentCore CLI's documentation says a knowledge base runs one ingestion job at a time, while ADR-0007 says 50. S3-08 checks the current quota before choosing how to handle collisions;
    - the live check uploads a scanned, image-only PDF, to learn whether its text is indexed with image extraction off.
  - S3-07: the upload is a presigned PUT, not a presigned POST. It signs the size, the content type, and the SHA-256, so S3 refuses any other body, and the hash the API stores for skipping unchanged files is the real content's hash. The bucket's CORS now allows `PUT` only ([ADR-0007](../adr/0007-knowledge-base-store.md), "Upload and delete").
  - S3-07: "50 MB" is 50,000,000 bytes, for each file and in total. AWS doesn't say whether the connector's 50 MB filter counts 10^6 or 2^20 bytes per MB, and 50,000,000 passes under either reading.
  - S3-07: each candidate can store at most 100 documents, enforced in the same conditional update as the bytes. Without it, 1-byte files could make thousands of items and ingestion entries inside 50 MB.
  - S3-07: a reservation whose file never arrives is released by the same user's next `POST` or `GET /documents`, one hour after it was made. A TTL with a DynamoDB stream was considered: TTL deletion can take days, and it needs a stream and another Lambda. A scheduled sweep would need a scan or an index, which ADR-0006 avoids.
  - S3-07: `GET /documents` shows a fourth status, `UPLOADING`, before the file is in S3. `DELETE` refuses such a document with `409 upload-in-progress` until it arrives or its hour passes, and the page needs to show why.
  - S3-07: posting the same file while its first upload hasn't arrived returns `resumed`: the same reservation with a new URL. A retry after a failed upload is then never blocked for an hour, and its bytes aren't counted twice.
  - S3-07: unchanged files are skipped per user only. Skipping because another user stores the same content would tell one user what another has.
  - S3-07: the API finds the documents bucket by its fixed name, as it finds the table, not through SSM as the S3-06 details planned. The name is built by the same function as the bucket's, the IAM ARNs stay plain strings, and the SSM parameter stays for the agent runtime.
  - S3-07: the document API doesn't call Bedrock. After a delete, the S3 event starts the sync (S3-08), so the API's IAM has no `bedrock:` action.
  - S3-07: each route has its own Lambda (`CreateDocument`, `ListDocuments`, `DeleteDocument`), so each IAM policy holds only the calls its own code makes. `DeleteDocument` can't write or list objects.
  - S3-07: an earlier draft set the S3 client's `requestChecksumCalculation` to `WHEN_REQUIRED`, on the belief that the SDK's default would add a CRC32 to the presigned URL. Presigning with SDK 3.1146.0 showed it doesn't, because the request carries our own SHA-256. The setting was dropped, and a test pins the URL's query parameters.
  - S3-07: for S3-09: the page shows `UPLOADING`, uploads one file at a time or retries a `409 conflict`, and the content security policy's `connect-src` needs the bucket's origin (`https://cv-tailor-<env>-documents-<account>.s3.us-east-1.amazonaws.com`) for the PUT.
  - S3-15: the committed settings are a module (`modules/settings`), not `envs/*.tfvars` as the plan said. Each stack needs a different subset, and a shared `.tfvars` file warns about every variable a stack doesn't declare.
  - S3-15: the `bootstrap` stack's state isn't encrypted with KMS, because that stack creates the key. It holds no secrets, and the bucket encrypts it at rest.
  - S3-15: the state keys don't rotate automatically. Each costs USD 1 a month, and the first two rotations would each add USD 1 a month, against budgets of USD 5. A key that only wraps data keys wears very little, and it can still be rotated on demand ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md) §4).
  - S3-15: CI's bucket actions are `Get*`, `List*`, `Put*`, and four named actions, not `s3:*`, which `trivy` rates HIGH. Three findings are accepted, each with its reason in `infra/.trivyignore.yaml`: S3-managed keys on the documents and site buckets, and no WAF on CloudFront until the first `prod` release.
  - S3-15: some values that CDK set, or that AWS fills in, are now written out: CDK's verification email text; `custom:hd`'s length limits (0 to 2048, Cognito's maximum), without which the provider plans to recreate the user pool; and API Gateway's default error body and `401`, and Google's endpoints in the identity provider, without which every plan removes what AWS stores.
  - S3-15: the API has no preflight method on `/`, which has no routes, and each Lambda may write only to its own log group, instead of the account-wide managed policy.
  - S3-15: the deploy needs only the `CVT_DEV_ACCOUNT_ID` secret. The `stag` and `prod` account IDs and the alert email are no longer GitHub secrets.
- **Lessons learned:**
  - S3-06: the S3-06 details listed two data source changes from the S2-12 notes. Reading the whole connector reference found a third setting, deletion protection, whose default could have kept a deleted document retrievable. A setting with a service default needs its whole reference page read, not only the fields already known.
  - S3-15: AWS stores default values that a declarative tool must write out, or every plan tries to remove them. The first CI plan would have removed Google's endpoints from the identity provider. The plan right after the first apply (deploy runbook, step 7.6) is where this shows, so it must read `No changes.` before a merge.
  - S3-15: a data source can need a permission its resource doesn't. `data "aws_acm_certificate"` calls `acm:GetCertificate`. Exact-match policy tests can't find a missing permission, so the first CI plan is part of the check.
  - S3-15: ACM gives every certificate for the same domain in the same account the same validation `CNAME`, so a record left by an earlier certificate blocks a new one. The validation record now takes over an existing one (`allow_overwrite`).
  - S3-15: `aws cognito-idp update-user-pool` resets every setting it isn't given. To change one setting on a pool that's kept, use the console, or pass the whole configuration back.
- **Next sprint backlog:**
  - By the first `prod` release (Sprint 6): decide on a WAF for the web app's CloudFront distribution. `trivy`'s exception for it (`AWS-0011` in `infra/.trivyignore.yaml`) expires on 2026-11-04, and CI fails from that day until it's decided ([ADR-0013](../adr/0013-infrastructure-as-code-opentofu.md) §9).

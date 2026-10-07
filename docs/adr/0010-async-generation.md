# ADR-0010: Async Generation, SQS and a Worker Lambda

| Field       | Value         |
| ----------- | ------------- |
| Status      | Proposed      |
| Date        | 2026-10-06    |
| Deciders    | Project owner |
| Sprint item | S3-02         |

## Context

Generation runs asynchronously (GEN-04). In Sprint 3 the first job is a JD analysis (S3-11, S3-12). In Sprint 4 it becomes the full pipeline in `AGENTS.md` §5.3: JD Analyzer, Profile Matcher, the writers, the Style Agent, and the Reviewer. The agents run on AgentCore Runtime (`AGENTS.md` §5.4). The API runs on Lambda behind API Gateway, and the job is an item in the data table ([ADR-0006](0006-data-store.md)).

This ADR settles:

1. How a job runs: what starts the agent, and what waits for it.
2. How results reach the web app.
3. Who writes the job item.
4. Job states, time limits, how a stuck job becomes `FAILED`, and expiry.
5. Retries and idempotency: a retried start never runs the agent twice.
6. How the backend calls the runtime and is authorised, and the session ID for each job.
7. Cost at low volume.

Numbers in square brackets refer to [Sources](#sources).

### What AgentCore Runtime offers

| Fact                                                                                                                                                                                                                                                       | Source    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A synchronous `InvokeAgentRuntime` request may last up to 15 minutes. An asynchronous job may run up to 8 hours. Neither limit can be raised.                                                                                                              | [3]       |
| For async work, the agent answers at once and keeps working in the background. It tracks the work with `add_async_task` and `complete_async_task`, and its `/ping` endpoint reports `HealthyBusy` meanwhile.                                               | [1]       |
| Each `runtimeSessionId` gets its own microVM. The ID needs 33 to 256 characters. AgentCore doesn't link sessions to users; the backend must.                                                                                                               | [2][5]    |
| A session ends after an idle timeout (60 to 28,800 seconds, default 900) or a maximum lifetime (60 to 28,800 seconds, default 8 hours), whichever comes first. A sync request in progress counts as activity. `StopRuntimeSession` ends a session at once. | [2][4][6] |
| `InvokeAgentRuntime` has no idempotency token. It can fail with `RetryableConflictException` (409) and `ThrottlingException` (429).                                                                                                                        | [5]       |
| CPU is billed only while it is active, and not during I/O waits such as model calls. Memory is billed for the whole session, idle time included, until the session ends. There is no fixed cost.                                                           | [7]       |
| An agent whose entrypoint blocks can also block `/ping`, and a session that fails its health checks is ended.                                                                                                                                              | [1][2]    |

### Decision drivers

1. **The agent gets as little access as possible.** It reads untrusted JD text and retrieved documents (SAFE-01), so a successful prompt injection must find nothing useful to call.
2. **Bounded spend.** The number of paid runs at once has a hard cap, no job runs twice, and nothing has a fixed monthly cost. The `dev` budget is USD 5 per month.
3. **Few moving parts** that the owner understands and can maintain.
4. **Long enough.** A JD analysis takes seconds. A full generation, within its USD 0.10 budget (QUOTA-03), takes minutes.
5. **Room for a push channel** after the MVP, without changing the job flow.

## Options Considered

### Option A: AgentCore async, the agent writes the job item

The API Lambda calls `InvokeAgentRuntime`. The agent starts a background task, answers at once, and writes the result to the data table when it finishes.

- **Pros:** the fewest resources. Jobs can run up to 8 hours. It uses AgentCore's own async support [1].
- **Cons:** the runtime role needs write access to the data table. The runtime serves every user, so the access can't be limited to one user's partition, and a prompt-injected agent could write to any user's items. Keys are then built in Python too, against ADR-0006's one-module rule. A crashed microVM leaves the job `RUNNING`, and nothing retries the start. `POST /jobs` waits for a microVM to start, inside API Gateway's 29-second limit.

Rejected, because it fails driver 1.

### Option B: AgentCore async, the agent sends its result to a queue

As option A, but when it finishes, the agent sends its result, or a failure code, to a result queue. A TypeScript Lambda reads the queue and writes the job item. An SQS message holds up to 1 MiB [10], which fits a JD analysis and a CV with a cover letter.

- **Pros:** the agent needs only `sqs:SendMessage` on one queue, not the table. Keys stay in TypeScript. Jobs can run up to 8 hours.
- **Cons:** a prompt-injected agent could send a forged result for another user's job. The writer must accept a result only for a job that is `RUNNING` and carries a matching random per-job token. Nothing of ours caps how many runs happen at once, because the API invokes the runtime directly. `POST /jobs` still waits for a microVM to start. A crashed microVM still sends nothing.

Not chosen today. It is the move if a job ever needs more than option C's limit (see [When to revisit](#when-to-revisit-this-decision)).

### Option C: SQS and a worker Lambda (chosen)

The API writes the job item and sends an SQS message. A worker Lambda reads the message, calls `InvokeAgentRuntime` synchronously, waits for the answer, and writes the result.

- **Pros:** the agent has no AWS access beyond its model calls and knowledge base reads. Keys stay in TypeScript, in one module. The event source's maximum concurrency caps paid runs at once [13]. The queue gives a dead-letter queue and a visible backlog. `POST /jobs` returns after a DynamoDB write and an SQS send.
- **Cons:** a job is bounded by 15 minutes, which is both Lambda's limit and the sync request limit [3]. Three more resources: a queue, a dead-letter queue, and a worker Lambda. The worker is billed while it waits, about USD 0.00025 per minute at 256 MB [15].

Lambda's own async invocation (`InvocationType: Event`) could replace the queue. SQS is preferred, because its maximum concurrency caps runs without reserving account concurrency [13], the backlog is visible as a queue metric, and a dead-letter queue can be redriven from the console.

### Option D: Step Functions

A Standard state machine calls the runtime through the AgentCore SDK integration [8].

- **Pros:** a visual history of each run, and retries per state.
- **Cons:** the integration is request-response only, with no `.sync` or callback pattern [8], so a call is still bounded by the 15-minute sync limit. LangGraph already orchestrates the agents inside the runtime, so the state machine would duplicate it. USD 0.000025 per state transition after 4,000 free each month [9]. It is a new service to learn and maintain for no gain over option C.

Rejected, because it fails driver 3.

### Options B and C side by side

|                                   | B: AgentCore async + result queue              | C: SQS + worker Lambda                                     |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Longest job                       | 8 hours                                        | 15 minutes                                                 |
| Cap on runs at once               | None of our own                                | The event source's maximum concurrency                     |
| `POST /jobs` waits for            | A microVM to start                             | A DynamoDB write and an SQS send                           |
| Agent's AWS access beyond Bedrock | `sqs:SendMessage` on one queue                 | None                                                       |
| Forged results                    | Possible, so a per-job token is needed         | Not possible: the worker writes the answer to its own call |
| New resources                     | Result queue, dead-letter queue, writer Lambda | Job queue, dead-letter queue, worker Lambda                |

## Decision

**Option C: an SQS queue and a worker Lambda call AgentCore Runtime synchronously. In the MVP, the web app polls the job's status. A WebSocket push follows after the MVP.**

```text
POST /jobs ─▶ API Lambda ─┬─▶ DynamoDB: GenerationJob (QUEUED, with the JD)
                          └─▶ SQS job queue: { sub, jobId }
                                  │  max concurrency 2, batch size 1
                                  ▼
                            Worker Lambda ─▶ kill switch, QUEUED → RUNNING
                                  │
                                  ├─▶ InvokeAgentRuntime (sync, session per job) ─▶ JD Analyzer ─▶ Bedrock
                                  ├─▶ DynamoDB: RUNNING → DONE + result | FAILED + code
                                  └─▶ StopRuntimeSession
                                  ✗ fails 5 times ─▶ dead-letter queue ─▶ alarm

GET /jobs/{id} (poll) ─▶ API Lambda ─▶ DynamoDB
```

### 1. How a job runs

1. `POST /jobs` checks the caller, the JD, and the kill switch (S3-12). It writes the job item as `QUEUED`, with the JD, and sends `{ sub, jobId }` to the job queue. The JD stays in the table and out of the queue, so there is one copy of it, and it expires with the job.
2. The SQS event source invokes the worker with one message at a time (batch size 1), and at most two workers run at once (maximum concurrency 2, the lowest value allowed [13]).
3. The worker reads the kill switch with the same module as the API. If AI is paused, it marks the job `FAILED` with `AI_PAUSED` and doesn't call the runtime. This covers a job that was queued before the switch turned off.
4. The worker moves the job from `QUEUED` to `RUNNING` with a conditional update (point 5), and calls `InvokeAgentRuntime` with the job's session ID (point 6).
5. The agent runs the job and returns the result, or a stable error code. Its entrypoint doesn't block `/ping`: the work runs in a thread or as async code [1].
6. The worker validates the answer against its contract in `packages/contracts` ([ADR-0003](0003-contracts-codegen.md)), and moves the job to `DONE` with the result, or to `FAILED` with a code. Then it calls `StopRuntimeSession`.

The agent is unchanged if the mechanism later moves to option B: only who calls it, and what happens to its answer, changes.

### 2. How results reach the web app

- **MVP: polling.** The page calls `GET /jobs/{id}` every 2 seconds for the first 30 seconds, then every 5 seconds, until the job is `DONE` or `FAILED`. It stops when the tab is hidden and resumes when it is shown again. A 60-second job costs about 20 requests (point 7). It needs no new infrastructure.
- **After the MVP: a WebSocket push.** An API Gateway WebSocket API, a connections table, an authoriser on `$connect`, and a push when a job changes state. USD 1 per million messages and USD 0.25 per million connection minutes [16]. Two rules in the MVP keep it a pure addition:
  - Every change of a job's state is written in one place, the worker (plus the stuck-job rule in point 4). The push can be driven from there, or from a DynamoDB stream on job items, with no change to the agent.
  - `GET /jobs/{id}` stays. The page uses it when it loads, after a reconnect, and while the socket is down.
- **Streaming is not used for generation.** A REST API can now stream a response for up to 15 minutes [17], but a job must survive the tab closing and must not depend on an open request. Streaming suits chat (CHAT-07), and is considered with the chatbot.

### 3. Who writes the job item

The worker and the API, both in TypeScript. Every key is built by `apps/api/src/data/keys.ts`, as [ADR-0006](0006-data-store.md) requires, and Python builds no keys. The runtime role has no DynamoDB actions at all, which narrows S3-10's role to SSM, model invocation, and Retrieve.

### 4. Job states, time limits, stuck jobs, and expiry

| State     | Set by                            | Next states         |
| --------- | --------------------------------- | ------------------- |
| `QUEUED`  | `POST /jobs`                      | `RUNNING`, `FAILED` |
| `RUNNING` | The worker                        | `DONE`, `FAILED`    |
| `DONE`    | The worker                        | None                |
| `FAILED`  | The worker, or the stuck-job rule | None                |

Every change is a conditional update on the current state, so two writers can't both win.

The job item keeps the keys in ADR-0006 and adds: `status`, `jd`, `createdAt`, `startedAt`, `finishedAt`, `result` (when `DONE`), `errorCode` (when `FAILED`), and `expiresAt`. `errorCode` is a stable code, such as `AI_PAUSED`, `TIMED_OUT`, `QUEUE_TIMEOUT`, `INVALID_RESULT`, or `AGENT_ERROR`. It never holds model text or the JD (SAFE-04).

Initial time limits, each shorter than the one after it, so the inner layer always gives up first. S3-11's measured run times may lower them.

| Limit                                     | Value                       | Why                                                                                      |
| ----------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| The worker's `InvokeAgentRuntime` timeout | 9 minutes                   | Leaves the worker time to write `FAILED` and stop the session                            |
| Worker Lambda timeout                     | 10 minutes                  | Below Lambda's and the sync request's 15 minutes [3]                                     |
| A `RUNNING` job is stuck after            | 12 minutes from `startedAt` | After the worker's timeout, so the worker always writes first                            |
| A `QUEUED` job is stuck after             | 15 minutes from `createdAt` | Nobody waits longer than that for a job to start                                         |
| Queue visibility timeout                  | 60 minutes                  | Six times the worker's timeout, as AWS advises [12]                                      |
| Receives before the dead-letter queue     | 5                           | AWS's advised minimum [12]                                                               |
| Runtime idle timeout / maximum lifetime   | 120 seconds / 15 minutes    | A backstop if `StopRuntimeSession` fails; a sync request keeps the session active [2][4] |

**A stuck job becomes `FAILED` when it is read.** `GET /jobs/{id}` and `GET /jobs` treat a job past its limit as `FAILED` (`TIMED_OUT` or `QUEUE_TIMEOUT`), and `GET /jobs/{id}` writes that with a conditional update. No scheduled sweeper is needed. A worker that answers after that loses the conditional update, and its result is dropped.

**A message that fails five times** goes to the dead-letter queue, and a CloudWatch alarm fires when the dead-letter queue holds any message.

**Expiry.** Every job carries `expiresAt`, set when it is created, so the JD and the result aren't kept forever (SAFE-04). DynamoDB's TTL deletes an expired item some time after it expires, so reads also treat an expired item as gone. The retention is **[30 days — to be confirmed in review]**. GEN-05 (the refinement conversation) may change it.

### 5. Retries and idempotency

- `POST /jobs` creates the job with `attribute_not_exists(PK)`, so an ID can't be reused.
- The worker moves `QUEUED` to `RUNNING` with a condition **before** it calls the runtime. SQS can deliver a message more than once [11]. A second delivery finds the job no longer `QUEUED`, and stops without calling the runtime. So the agent never runs twice for one job.
- The cost of that rule: if the worker crashes after the move, the job isn't retried. It becomes `FAILED` by the stuck-job rule, and the user submits it again. A lost job is cheaper than a second paid run.
- Short AWS errors before the move, such as a throttle, are retried by the AWS SDK inside the same attempt. A message that still fails is seen again only after the visibility timeout, by which time its job is past the `QUEUED` limit. So in practice, a failure before the start fails the job.
- `InvokeAgentRuntime` has no idempotency token [5], and the AWS SDK retries some of its errors. In case a retried call reaches an agent that is already running the job, the agent refuses a second start of the same job ID within its session. One session per job (point 6) makes that check enough.
- A double click on "Analyze" creates two jobs. A client idempotency key is deferred: until the quota exists (Sprint 6), only the `admin` group can call `POST /jobs`.

### 6. Calling the runtime

- **Authorisation: IAM (SigV4),** the runtime's default inbound auth. No OAuth, and AgentCore Identity isn't used (`AGENTS.md` §5.4).
- **The worker role** gets exactly: `dynamodb:GetItem` and `dynamodb:UpdateItem` on the data table; `bedrock-agentcore:InvokeAgentRuntime` and `bedrock-agentcore:StopRuntimeSession` on the runtime and its endpoint [5][6]; `ssm:GetParameter` on `/cv-tailor/ai-calls`; and what the SQS event source needs to read the job queue. An exact-match test checks the list, as for the other Lambdas. S3-10 confirms the exact resource ARNs.
- **The API role** adds `sqs:SendMessage` on the job queue only.
- **Session ID:** `cv-tailor-job-<jobId>`, built by one TypeScript function and tested for the 33-character minimum [5]. With a UUID v7 job ID ([ADR-0006](0006-data-store.md), S3-03), the session ID is 50 characters.
- **One session per job.** Each job gets a fresh, isolated microVM [2], so nothing from one job, or one user, is left in memory for the next.
- **Payload:** `{ jobId, sub, jd }`. The agent needs `sub` to build its knowledge base identity (S3-10). The request and the answer are contracts in `packages/contracts`, named in S3-11 and S3-12. No log line holds the JD or the result.
- **Ending the session:** the worker calls `StopRuntimeSession` after every call, including after its own timeout, so an agent that the worker gave up on also stops spending. A failure to stop is logged, not thrown, and the idle timeout in point 4 is the backstop. Without this, each job would pay for up to 15 minutes of idle memory (point 7). The AgentCore documentation doesn't say whether an agent stops when the caller of a sync request disconnects, so the explicit stop is the safe choice.

### 7. Cost at low volume

**Fixed cost: none.** SQS, Lambda, and AgentCore Runtime have no hourly charge [7][14][15]. The one cost that runs while idle is the SQS event source's long polling of an empty queue. AWS doesn't document how many pollers it runs. An estimate of five pollers, each making a 20-second long poll, is about 650,000 requests per month, inside SQS's 1 million free requests per month [14]. This is checked after deployment (see [Verification](#verification)).

**Per job,** for a JD analysis that runs for 30 seconds, uses 1 vCPU for 3 seconds of it (the rest is waiting for the model), and holds 0.5 GB of memory. These are assumptions until S3-11 measures them.

| Part                           | Arithmetic                                                                     | USD              |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------- |
| Runtime CPU [7]                | 3 s × 1 vCPU × 0.0895 per vCPU-hour                                            | 0.000075         |
| Runtime memory [7]             | 30 s × 0.5 GB × 0.00945 per GB-hour                                            | 0.000039         |
| Worker waiting [15]            | 30 s × 0.25 GB × 0.0000166667 per GB-second (x86 rate, an upper bound for Arm) | 0.000125         |
| Polling, 20 requests [15][16]  | API Gateway 20 × 3.50 per million, plus Lambda                                 | 0.00008          |
| SQS, 3 requests [14]           | Inside the free tier                                                           | 0                |
| **Total, without model calls** |                                                                                | **about 0.0003** |

That is 0.3% of the USD 0.10 budget for a generation. Model calls are the topic of ADR-0011 (S3-04).

**The idle memory trap:** with the default 15-minute idle timeout and no `StopRuntimeSession`, each job's microVM would hold its memory for 15 more minutes: 900 s × 0.5 GB × 0.00945 per GB-hour = USD 0.0012, about ten times the runtime cost of the job itself. Point 6 avoids it.

For comparison, option D adds about 5 state transitions per job (USD 0.000125 after the free tier) [9], and options A and B save the worker's waiting time but add the cost of a longer `POST /jobs`.

## Consequences

### Positive

- The agent can't write to the data table or send messages: a prompt injection that takes over the agent has no AWS action to misuse beyond model calls and its own knowledge base reads.
- At most two paid runs happen at once, whatever the traffic, and a job never runs twice.
- Every key stays in one TypeScript module.
- No fixed cost, and no scheduler for stuck jobs.
- `POST /jobs` answers quickly, and the backlog is visible as a queue metric.

### Negative

- A job can't run longer than about 10 minutes.
- More code to own and test: the worker, and the stuck-job rule in the API.
- A failure before a job starts usually fails the job, rather than retrying it (point 5).
- With two workers, a burst of jobs waits in the queue. The `QUEUED` limit turns a long wait into `QUEUE_TIMEOUT`.

### Risks and mitigations

| Risk                                                                                   | Mitigation                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| The worker gives up, but the agent keeps calling models.                               | The worker always calls `StopRuntimeSession`. The runtime's maximum lifetime (15 minutes) and the guard's kill switch (S2-11) are backstops. |
| A full generation in Sprint 4 needs more than 10 minutes.                              | S3-11 and Sprint 4 measure run times. Above about 8 minutes, this ADR is revisited, with option B as the move.                               |
| The idle SQS polling exceeds the free tier, for example once S3-08 adds another queue. | Checked after deployment with the queue's `NumberOfEmptyReceives` metric. Beyond the free tier it is cents per month.                        |
| A blocked `/ping` ends a long session.                                                 | The agent runs its work off the request thread (point 1), which S3-11 tests.                                                                 |
| The result outgrows a DynamoDB item (400 KB).                                          | A JD analysis is a few KB, and a CV with a cover letter tens of KB. If it grows, the result moves to S3, with a pointer on the item.         |

### When to revisit this decision

- A job needs more than about 8 minutes: move to option B (AgentCore async with a result queue and a per-job token).
- The WebSocket push is built, after the MVP. It must settle how `$connect` checks the Cognito access token, because a browser can't set headers on a WebSocket (a short-lived ticket or a query string parameter), and what a connection costs at the expected traffic.
- Two workers at once is too few once the quota opens generation to every candidate (Sprint 6).

## Verification

Checked in S3-10 and S3-12:

1. `tofu test` shows: the job queue with a 60-minute visibility timeout and a redrive policy to its dead-letter queue after 5 receives; the worker's event source with batch size 1, maximum concurrency 2, and partial batch responses; a 10-minute worker timeout; the runtime's lifecycle at 120 seconds idle and 15 minutes maximum; and an alarm on the dead-letter queue.
2. Exact-match tests show that the runtime role has no DynamoDB or SQS actions, and that the worker role has only the actions in point 6.
3. Unit tests show that the worker:
   - doesn't call the runtime for a job that isn't `QUEUED`;
   - marks a job `FAILED` with `AI_PAUSED` without calling the runtime when the switch is off;
   - marks a job `FAILED` with `INVALID_RESULT` when the answer doesn't match its contract;
   - calls `StopRuntimeSession` after success, failure, and its own timeout.
4. Unit tests show that `GET /jobs/{id}` turns a job past its limit into `FAILED`, and that a late worker write then loses.
5. A test shows that the session ID has at least 33 characters for the chosen ID format.
6. Live in `dev`: a job reaches `DONE`. Sending the same message to the queue a second time doesn't start a second run (the runtime's invocation metrics show one call).
7. After a day in `dev`, the job queue's `NumberOfEmptyReceives` confirms the idle polling estimate in point 7.

## Sources

Accessed 2026-10-06.

1. Handle asynchronous and long running agents: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html>
2. Use isolated sessions for agents: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html>
3. Quotas for Amazon Bedrock AgentCore: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html>
4. Configure AgentCore lifecycle settings: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-lifecycle-settings.html>
5. `InvokeAgentRuntime` API reference: <https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeAgentRuntime.html>
6. Stop a running session: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-stop-session.html>
7. Amazon Bedrock AgentCore pricing: <https://aws.amazon.com/bedrock/agentcore/pricing/>
8. Invoke Amazon Bedrock AgentCore with Step Functions: <https://docs.aws.amazon.com/step-functions/latest/dg/connect-bedrockagentcore.html>
9. AWS Step Functions pricing: <https://aws.amazon.com/step-functions/pricing/>
10. Amazon SQS increases maximum message payload size to 1 MiB (2025-08-04): <https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-sqs-max-payload-size-1mib>
11. Amazon SQS visibility timeout: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
12. Creating and configuring an Amazon SQS event source mapping: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html>
13. Configuring scaling behavior for SQS event source mappings: <https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-scaling.html>
14. Amazon SQS pricing: <https://aws.amazon.com/sqs/pricing/>
15. AWS Lambda pricing: <https://aws.amazon.com/lambda/pricing/>
16. Amazon API Gateway pricing: <https://aws.amazon.com/api-gateway/pricing/>
17. Amazon API Gateway now supports response streaming for REST APIs (2025-11-19): <https://aws.amazon.com/about-aws/whats-new/2025/11/api-gateway-response-streaming-rest-apis>

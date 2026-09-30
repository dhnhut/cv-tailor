# AWS Service Availability Report

**Backlog items:** S0-07, S1-10 (per-account results) · **Input to:** [ADR-0002](../adr/0002-aws-region.md) (S0-08)

**Decision:** the project runs in a **single region, `us-east-1`**, for all environments. See [ADR-0002](../adr/0002-aws-region.md). The Auckland and Sydney columns are kept as a record of the options compared.

**Checked:** 2026-09-27 · **Account:** `<pre-org account>` (`cv-dev` profile, pre-Organizations account)

**Re-checked in dev:** 2026-09-30 · **Account:** `<dev account>` (`cvt-dev` profile). See [section 7](#7-per-account-results).

**Regions compared:** Auckland (`ap-southeast-6`), Sydney (`ap-southeast-2`), N. Virginia (`us-east-1`)

---

## 1. Summary

| Region    | Has every required service? | What is missing                                                                                        |
| --------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Auckland  | **No**                      | All of AgentCore, Bedrock Guardrails, Bedrock Knowledge Bases, embedding models, OpenSearch Serverless |
| Sydney    | **Yes**                     | Nothing                                                                                                |
| us-east-1 | **Yes**                     | Nothing                                                                                                |

Both Sydney and `us-east-1` have every required service. `us-east-1` was chosen for simplicity and the widest feature coverage. The reasons and trade-offs are in ADR-0002.

In Auckland, Bedrock exists only as a **cross-region inference source**: calls start in Auckland and are processed in Sydney, Melbourne, or Auckland. The agent platform (AgentCore) and the RAG and safety features are not offered there yet.

---

## 2. Method

Each result uses up to three evidence sources, as defined in the sprint plan:

| Code    | Source                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Doc** | AWS documentation or an AWS announcement (links in [section 8](#8-sources)).                                                                      |
| **API** | A read-only list call from [`scripts/aws-service-check.sh`](../../scripts/aws-service-check.sh) against the region's endpoint.                    |
| **SSM** | The public parameter list `/aws/service/global-infrastructure/regions/<region>/services`. It can lag behind, so it is used as a cross-check only. |

How to read the API results:

| Result        | Meaning                                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OK`          | The call succeeded, so the service is available.                                                                                                                                                         |
| `NO_ENDPOINT` | No endpoint exists in that region. The service is **not available**.                                                                                                                                     |
| `NOT_OFFERED` | The endpoint exists but answers "Your account is not authorized to invoke this API operation". The same user calls the same API successfully in Sydney, so this is a regional limit, not an IAM problem. |
| `ERR(...)`    | Any other error, which needs a manual check.                                                                                                                                                             |

---

## 3. Service Matrix

✅ available · ❌ not available · ⚠️ see note

### 3.1 AgentCore (AGENTS.md §5.4)

| Feature       | Auckland | Sydney | us-east-1 | Evidence                        |
| ------------- | -------- | ------ | --------- | ------------------------------- |
| Runtime       | ❌       | ✅     | ✅        | Doc [1], API, SSM               |
| Memory        | ❌       | ✅     | ✅        | Doc [1], API, SSM               |
| Gateway       | ❌       | ✅     | ✅        | Doc [1], API, SSM               |
| Observability | ❌       | ✅     | ✅        | Doc [1] (no list API)           |
| Browser       | ❌       | ✅     | ✅        | Doc [1] ("Built-in Tools"), API |
| Evaluations   | ❌       | ✅     | ✅        | Doc [1], API                    |
| Policy        | ❌       | ✅     | ✅        | Doc [1], API                    |

- Auckland is not a column in the AgentCore region table [1], and the `bedrock-agentcore-control` endpoint for `ap-southeast-6` does not exist (`Could not connect to the endpoint URL`).
- **AgentCore CLI names confirmed** (AWS CLI 2.36.49): control plane `aws bedrock-agentcore-control` (`list-agent-runtimes`, `list-memories`, `list-gateways`, `list-browsers`, `list-evaluators`, `list-online-evaluation-configs`, `list-policy-engines`); data plane `aws bedrock-agentcore` (`list-sessions`, `list-events`, `list-memory-records`, and others).

### 3.2 Bedrock

| Feature                         | Auckland | Sydney | us-east-1 | Evidence                        |
| ------------------------------- | -------- | ------ | --------- | ------------------------------- |
| Foundation model catalogue      | ✅       | ✅     | ✅        | API, SSM                        |
| Claude inference (via profiles) | ⚠️ 1     | ✅     | ✅        | Doc [2], API                    |
| Embedding models (for RAG)      | ❌       | ✅     | ✅        | Doc [3], API                    |
| Guardrails                      | ❌       | ✅     | ✅        | API (`NOT_OFFERED` in Auckland) |
| Knowledge Bases                 | ❌ 2     | ✅     | ✅        | Doc [3][4], API                 |

1. Auckland serves only 4 Claude models through `au.` profiles (Haiku 4.5, Sonnet 4.5, Sonnet 4.6, Opus 4.6). Newer models are available only through `global.` profiles there.
2. `ListKnowledgeBases` returns `InternalServerErrorException` in Auckland, and Auckland isn't listed for Knowledge Bases in the docs [3][4]. Treated as not available.

**Claude inference profiles per region** (from `list-inference-profiles`):

| Profile type                            | Auckland | Sydney | us-east-1 |
| --------------------------------------- | -------- | ------ | --------- |
| `au.` (routes only within Australia/NZ) | 4        | 9      | 0         |
| `global.` (routes worldwide)            | 12       | 12     | 13        |
| `us.` (routes within the US)            | 0        | 0      | 16        |

Sydney `au.` profiles: Haiku 4.5; Sonnet 4.5, 4.6, 5; Opus 4.6, 4.7, 4.8, 5, 5.5. Fable 5 and 5.1 are available in Sydney **only** through `global.` profiles.

**Embedding models in Sydney** (on-demand): Titan Text Embeddings V2, Cohere Embed English v3, Cohere Embed Multilingual v3, Cohere Embed v4. Titan V2 and both Cohere v3 models are listed as supported for Knowledge Bases in Sydney [3].

### 3.3 Core services (AGENTS.md §7)

| Service                           | Auckland | Sydney | us-east-1 | Evidence                             |
| --------------------------------- | -------- | ------ | --------- | ------------------------------------ |
| Cognito user pools                | ✅       | ✅     | ✅        | API, SSM                             |
| API Gateway REST                  | ✅       | ✅     | ✅        | API, SSM                             |
| API Gateway HTTP / WebSocket (v2) | ✅       | ✅     | ✅        | API (SSM misses Auckland, see §6)    |
| Lambda (`nodejs24.x`)             | ✅       | ✅     | ✅        | API, SSM, Doc [5] (see §6)           |
| DynamoDB                          | ✅       | ✅     | ✅        | API, SSM                             |
| S3                                | ✅       | ✅     | ✅        | API, SSM                             |
| SQS                               | ✅       | ✅     | ✅        | API, SSM                             |
| Step Functions                    | ✅       | ✅     | ✅        | API, SSM                             |
| SSM Parameter Store               | ✅       | ✅     | ✅        | API, SSM                             |
| Secrets Manager                   | ✅       | ✅     | ✅        | API, SSM                             |
| Budgets                           | global   | global | global    | API (single endpoint in `us-east-1`) |
| CloudFront                        | global   | global | global    | API (global service)                 |

### 3.4 Vector store options (region and pricing notes only; the choice is made in a later sprint)

| Option                                          | Auckland | Sydney | us-east-1 | Pricing note                                                                                                                                                |
| ----------------------------------------------- | -------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3 Vectors                                      | ✅       | ✅     | ✅        | Pay per use (storage, writes, queries). No fixed monthly minimum.                                                                                           |
| OpenSearch Serverless (vector)                  | ❌       | ✅     | ✅        | Billed in OCUs with a minimum capacity, so it has a **fixed monthly floor**. Exact figure to confirm on the pricing page when the vector store is chosen.   |
| Bedrock Managed Knowledge Base (built-in store) | ❌       | ✅     | ✅        | GA 2026-06-17 [4]. The vector store is managed by Bedrock, so no separate store to run. Pricing to compare when the vector store is chosen.                 |
| Aurora PostgreSQL (pgvector)                    | ✅       | ✅     | ✅        | Serverless v2 can scale to 0 ACUs (auto-pause) from PostgreSQL 16.3 / 15.7 [6]. Resume takes about 15 s, or 30 s+ after 24 h idle. Storage is still billed. |

Doc evidence: S3 Vectors region table [7]. For low traffic, S3 Vectors and Aurora with auto-pause avoid a fixed minimum cost. OpenSearch Serverless doesn't.

---

## 4. Data Residency (PII)

With `us-east-1` as the only region, candidate PII is **stored and processed in the United States**.

| Question                                   | Answer                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is data at rest?                     | `us-east-1`: S3, DynamoDB, Cognito, Knowledge Bases, and AgentCore Memory.                                                                                                        |
| Where do `us.` profiles send requests?     | US regions only.                                                                                                                                                                  |
| Where do `global.` profiles send requests? | Any supported commercial region worldwide [2]. Prompts, which may contain PII, can then be processed outside the US.                                                              |
| Could PII have stayed in **New Zealand**?  | No, not today. The knowledge base, AgentCore Memory, and Guardrails are not offered in Auckland.                                                                                  |
| Could PII have stayed in **Australia**?    | Yes, with Sydney as the home region and `au.` profiles only (they route to Sydney and Melbourne, checked with `get-inference-profile`). This option was not chosen; see ADR-0002. |

A legal assessment (for example, cross-border rules under the NZ Privacy Act 2020 or the Australian Privacy Principles) is out of scope for this report.

---

## 5. Caveats

- **Per-account results.** Model access, opt-in regions, and service quotas are per account, and SCPs and permission sets can block calls. [Section 7](#7-per-account-results) records the results for each workload account. `dev` was checked on 2026-09-30; `stag` and `prod` are checked before their first deploy.
- **Snapshot in time.** Auckland opened on 2025-09-02 and Bedrock inference arrived there on 2026-03-26 [2], so services are still being added. Re-check before any future move to Auckland.
- **The script doesn't call inference.** `InvokeModel` costs money, so the script proves profiles exist, not that invocation works. In `dev`, two tiny manual calls proved invocation on 2026-09-30 ([section 7.1](#71-dev)).
- **Observability** has no list API of its own, so it relies on the docs [1]. It is built on CloudWatch and X-Ray, which are available in all three regions (SSM).

---

## 6. Other Findings

1. **The SSM list lags behind.** It doesn't list `apigatewayv2` in Auckland, yet the API answers. This confirms the plan to treat SSM as a cross-check only.
2. **Lambda Node.js 22 deprecates soon (resolved).** The Lambda runtime table [5] lists `nodejs22.x` with deprecation on **2027-04-30**, blocked creation on 2027-06-01, and blocked updates on 2027-07-01. `nodejs24.x` deprecates on 2028-04-30. As a result, the backend moved from Node.js 22 to Node.js 24 (AGENTS.md §7).

---

## 7. Per-account results

The script is re-run in each workload account, because the results in sections 3.2 and 5 depend on the account. Account IDs are not recorded ([ADR-0004](../adr/0004-accounts-and-access.md) §2).

### 7.1 dev

**Checked:** 2026-09-30, after S1-05 was applied · **Account:** `<dev account>` (`cvt-dev` profile, `AdministratorAccess` permission set) · **Guardrails:** baseline SCP on Root ([`infra/org/scps/baseline.json`](../../infra/org/scps/baseline.json))

**Result:** every required service is available in `us-east-1`. All 23 API probes and both global-service probes return `OK`. The SSM cross-check lists all 18 service names. The region opt-in status is `opt-in-not-required`.

**Differences from Sprint 0:**

| Item                                | Sprint 0 (2026-09-27)        | dev (2026-09-30)               | Reason                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account                             | Pre-Organizations account    | `cv-tailor-dev` member account | Expected. The Organization's accounts (S1-03) replaced the old account.                                                                                                                    |
| Guardrails                          | None                         | Baseline SCP                   | No effect on the check: the output is identical with and without the SCP (runs at 09:19 and 11:57 UTC, before and after S1-05 was applied). The SCP only denies calls outside `us-east-1`. |
| Claude `global.` inference profiles | 13                           | 14                             | A catalogue change, not an account difference. `global.anthropic.claude-sonnet-5-5` was created on 2026-09-28 (`createdAt` in `list-inference-profiles`), after the Sprint 0 check.        |
| Claude `us.` inference profiles     | 16                           | 16                             | No change. Sonnet 5.5 has no `us.` profile yet, so it is reachable only through its `global.` profile, which the baseline SCP allows ([ADR-0002](../adr/0002-aws-region.md)).              |
| Embedding models (on-demand)        | Not recorded for `us-east-1` | 10                             | New data point. Sprint 0 listed the embedding models for Sydney only. The list is below.                                                                                                   |
| Model access                        | Not checked                  | Proven (see below)             | New in this sprint.                                                                                                                                                                        |

**Model access.** AWS now enables serverless Bedrock models by default, and there is no Model access page to request them on [10]. An Anthropic model needs two more things:

- The **Anthropic use-case form**, submitted once per account or once in the Organization's management account, which every member account inherits.
- An **AWS Marketplace subscription**, which Bedrock creates automatically on the first call.

Amazon models need neither.

| Check                                | Command (`--profile cvt-dev --region us-east-1` unless noted)                                         | Result                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Anthropic use-case form (management) | `aws bedrock get-use-case-for-model-access --profile org-mgmt`                                        | Submitted                                                                                   |
| Anthropic use-case form (dev)        | `aws bedrock get-use-case-for-model-access`                                                           | Same form data as the management account, so it is inherited. Nothing was submitted in dev. |
| Claude Haiku 4.5 access              | `aws bedrock get-foundation-model-availability --model-id anthropic.claude-haiku-4-5-20251001-v1:0`   | `AVAILABLE`, `AUTHORIZED` (the subscription already existed from earlier console use)       |
| Amazon Nova Micro call               | `aws bedrock-runtime converse --model-id us.amazon.nova-micro-v1:0 … --inference-config maxTokens=20` | Succeeds (24 tokens)                                                                        |
| Claude Haiku 4.5 call                | `aws bedrock-runtime converse --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0 … maxTokens=20`  | Succeeds (16 tokens)                                                                        |
| Claude Haiku 4.5 call (`global.`)    | The same call with `--model-id global.anthropic.claude-haiku-4-5-20251001-v1:0`                       | Succeeds                                                                                    |

The calls were repeated after S1-05 was applied, with the same results, so the baseline SCP lets both `us.` and `global.` profiles through ([`infra/org/README.md`](../../infra/org/README.md), verify steps 3 and 3a). The form's contents are not recorded here, because they hold personal details.

<details><summary>Embedding models in us-east-1 (on-demand)</summary>

- Amazon Nova 2 Multimodal Embeddings (`amazon.nova-2-multimodal-embeddings-v1:0`)
- Amazon Titan Embeddings G1 Text (`amazon.titan-embed-g1-text-02`, `amazon.titan-embed-text-v1`)
- Amazon Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`)
- Amazon Titan Multimodal Embeddings (`amazon.titan-embed-image-v1`)
- Cohere Embed English v3, Multilingual v3, and v4
- TwelveLabs Marengo Embed 2.7 and 3.0

</details>

### 7.2 stag and 7.3 prod

Not checked yet. Deploys to `stag` and `prod` are out of scope in Sprint 1. Run the script with `--profile cvt-stag` or `--profile cvt-prod` before each account's first deploy. The use-case form is inherited, so only the live calls and the probes need checking.

---

## 8. Sources

Sources 1–9 accessed on 2026-09-27; source 10 on 2026-09-30.

1. AgentCore supported Regions: <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html>
2. "Run Generative AI inference with Amazon Bedrock in Asia Pacific (New Zealand)", AWS ML Blog, 2026-03-26: <https://aws.amazon.com/blogs/machine-learning/run-generative-ai-inference-with-amazon-bedrock-in-asia-pacific-new-zealand/>
3. Supported models and Regions for Bedrock Knowledge Bases: <https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-supported.html>
4. Amazon Bedrock Managed Knowledge Base GA (June 2026): <https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-managed-knowledge-base/>
5. Lambda runtimes: <https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html>
6. Aurora Serverless v2 auto-pause: <https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html>
7. S3 Vectors Regions and quotas: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-regions-quotas.html>
8. Now open: AWS Asia Pacific (New Zealand) Region: <https://aws.amazon.com/blogs/aws/now-open-aws-asia-pacific-new-zealand-region>
9. SSM public parameters for global infrastructure: `aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions/<region>/services`
10. Access Amazon Bedrock foundation models: <https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html>

---

## 9. Re-run

```bash
# The project region only (default)
bash scripts/aws-service-check.sh --profile <aws-profile> > /tmp/service-check.md

# All three regions, to reproduce the full matrix in section 3
bash scripts/aws-service-check.sh --profile <aws-profile> --regions "ap-southeast-6 ap-southeast-2 us-east-1"
```

Compare the "API probes" table with the `us-east-1` column in section 3. Record the results and any mismatch, with its date, in [section 7](#7-per-account-results). The output includes the account ID, so write it outside the repository.

In the workload accounts, only the default `us-east-1` run is meaningful. The baseline SCP denies every other region, so a three-region run shows `DENIED` for Auckland and Sydney.

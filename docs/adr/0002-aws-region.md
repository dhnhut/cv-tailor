# ADR-0002: Single AWS Region, `us-east-1`

| Field       | Value                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                                                                                                 |
| Date        | 2026-09-27                                                                                                                                               |
| Amended     | 2026-09-30: `global.` inference profiles may be used for any task; 2026-10-07: the region is set in OpenTofu, and verification step 2 is updated (S3-15) |
| Deciders    | Project owner                                                                                                                                            |
| Sprint item | S0-08                                                                                                                                                    |

## Context

CV Tailor needs AWS Bedrock AgentCore (Runtime, Memory, Gateway, Observability, Browser, Evaluations, Policy), Bedrock (Guardrails, Knowledge Bases, foundation and embedding models), and a set of core serverless services. The users are worldwide, with a focus on New Zealand and Australia.

The Sprint 0 plan compared three regions: Auckland (`ap-southeast-6`), Sydney (`ap-southeast-2`), and N. Virginia (`us-east-1`). The evidence is in the [service availability report](../cloud/service-availability.md). In short:

| Region    | Every required service? | Gaps                                                                                                  |
| --------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Auckland  | No                      | All of AgentCore, Bedrock Guardrails, Knowledge Bases, embedding models, OpenSearch Serverless        |
| Sydney    | Yes                     | None. Some models (Fable 5 / 5.1) are available only through `global.` inference profiles.            |
| us-east-1 | Yes                     | None. It also has AgentCore features that Sydney does not have yet (for example the Web Search tool). |

### Decision drivers

1. **Every required service in one place.** No feature should be blocked by region.
2. **Simplicity.** One region means one set of endpoints, IAM ARNs, infrastructure stacks, and runbooks per environment.
3. **Access to new features.** AgentCore and Bedrock are changing fast, and new features and models usually reach `us-east-1` first.
4. **Latency and data residency** for NZ and AU users.

## Options Considered

### Option A: Auckland

- **Pros:** lowest latency for NZ users; data at rest could stay in NZ.
- **Cons:** AgentCore, Guardrails, and Knowledge Bases are not offered. The core AI features can't run there.

Rejected, because it fails driver 1.

### Option B: Sydney

- **Pros:** every required service is available; low latency for AU and NZ; data at rest and (with `au.` inference profiles) model inference can stay in Australia.
- **Cons:** some newer AgentCore features and models reach it later; newer models such as Fable are `global.`-only there, so they would not keep data in Australia anyway.

### Option C: `us-east-1` (chosen)

- **Pros:**
  - Every required service and the widest set of models and AgentCore features.
  - New features usually launch here first, which suits a platform that is still changing.
  - Some AWS resources must be in `us-east-1` whatever the main region is (the ACM certificate for CloudFront, and the Budgets API endpoint). With one region, everything lives together.
  - Most AWS documentation, examples, and samples use this region.
- **Cons:**
  - Candidate PII is stored and processed in the US, not in NZ or AU.
  - About 130–200 ms of extra network round-trip time for NZ and AU users. Model response times (seconds) are much larger than this, so the effect on the user is small.

### Option D: Split region (user data in Sydney, missing services elsewhere)

- **Pros:** data residency where possible.
- **Cons:** cross-region calls, two sets of endpoints and IAM ARNs, and more complex infrastructure. Not needed, because Sydney and `us-east-1` each have every service.

Rejected, because it adds complexity for no gain in service coverage.

## Decision

Use **a single AWS region, `us-east-1`**, for every environment (`dev`, `stag`, `prod`).

- All regional resources are deployed to `us-east-1`. CloudFront is global.
- Model calls may use `global.` inference profiles (worldwide routing) for any task, including as the default. `us.` profiles (US-only routing) stay available. Every call starts in `us-east-1`, which the baseline SCP enforces ([ADR-0004](0004-accounts-and-access.md)).
- Every OpenTofu provider sets the region explicitly, not from the developer's local profile.

Option C is chosen over Option B for simplicity and feature coverage. At the portfolio stage, keeping data in Australia matters less than having one region with every feature as early as possible.

## Consequences

### Positive

- One region per account. Stacks, IAM policies, dashboards, and runbooks all use the same region.
- No feature is blocked by regional availability.
- The CloudFront certificate, Budgets, and the application are in the same region.

### Negative

- Candidate PII (knowledge base documents, profiles, conversations) is stored in the US. Prompts sent through `global.` profiles, which can contain PII, may be processed in any supported commercial region. The privacy notice must say both clearly.
- NZ and AU users see extra network latency. Chat streaming and async generation hide most of it.
- Moving region later is expensive. Data in S3 and DynamoDB can be copied, but **Cognito user pools can't be moved**, and password hashes can't be exported. Users would have to be migrated, for example with a migration Lambda trigger or a password reset.

### Risks and mitigations

| Risk                                                                 | Mitigation                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user or partner requires data residency in NZ or AU.               | Keep region values in one place (`infra/modules/settings`), not hard-coded, so a second deployment in Sydney stays possible. Sydney had every service at the time of this decision. |
| A `us-east-1` regional outage affects the 99.9% availability target. | Accepted at the portfolio stage. Multi-region failover is out of scope.                                                                                                             |
| `global.` inference profiles process prompts outside the US.         | Accepted at the portfolio stage: data residency is not a requirement yet. If it becomes one (see below), move PII-bearing tasks to `us.` profiles.                                  |

### When to revisit this decision

- The product has real users who need their data to stay in NZ or AU.
- AgentCore and Bedrock reach full coverage in Auckland, and NZ users become the main audience.
- Latency measurements show a real problem for NZ and AU users.

## Verification

1. `bash scripts/aws-service-check.sh --profile <p>` shows every API probe as `OK` or `DENIED` for `us-east-1`, in each environment account once it exists (Sprint 1).
2. Every OpenTofu provider block sets `region = "us-east-1"`, and `tofu test` checks that the settings module's region is `us-east-1`.

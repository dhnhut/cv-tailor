# CV Tailor

An AI application that writes a tailored CV and cover letter for a specific job. It is built on AWS Bedrock AgentCore with a multi-agent design. It uses only facts from the candidate's own documents.

This file holds **decided** product scope, architecture, and working rules. Sprint plans live in [`docs/sprints/`](docs/sprints/).

---

## 1. How AI Is Used in This Project

AI is a collaborator, not an autopilot.

### Working rules

- **Human-in-the-loop.** AI proposes and I approve. Nothing is implemented without my approval.
- **No vibe coding.** Every change is understood and reviewed before it is merged.
- **Challenge decisions.** AI should question my choices and suggest better options when it sees them.
- **Delegation.** AI may run simple or time-consuming tasks when I ask it to.
- **Long-term maintainability.** Every part of the system must be understood well enough to maintain.

### Output standard

- Use clean, simple, direct language.
- Give suggestions step by step, with code, scripts, and **verification steps**.
- Explain the reason for each idea, with an example.
- Be honest. Do not assume or guess. Say "I don't know" when that is true.
- Ask questions until the requirement is clear.

---

## 2. Product Overview

| Item        | Description                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Problem     | Tailoring a CV and cover letter for each job takes a long time.                                                                    |
| Solution    | A candidate builds a personal knowledge base once. The system uses it to write job-specific documents in the candidate's own tone. |
| Extra value | A public chatbot lets headhunters ask about the candidate and check job fit.                                                       |
| Users       | Worldwide, with a focus on New Zealand and Australia.                                                                              |
| Quota model | Token-based quota to prevent abuse, not to make money.                                                                             |

---

## 3. Roles

| Role       | Description                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Candidate  | Registers for free, builds a knowledge base, generates CVs and cover letters, and manages the personal chatbot. |
| Headhunter | Chats with a candidate's chatbot to check job fit and ask questions.                                            |
| Admin      | Manages quotas and system controls.                                                                             |

---

## 4. Functional Requirements

Each requirement has an ID so sprint backlogs can refer to it.

### 4.1 Accounts and Authentication (AUTH)

| ID      | Requirement                                                                                                                                                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-01 | A candidate can register for free.                                                                                                                                                                                                                                                             |
| AUTH-02 | Sign-in uses Amazon Cognito with email/password and OAuth (Google at launch, LinkedIn planned). Sign-ins with the same verified email are linked to one account. At launch, Google sign-in accepts Gmail and Google Workspace addresses ([ADR-0009](docs/adr/0009-sign-in-and-api-access.md)). |
| AUTH-03 | Email verification is optional. A verified account gets a higher quota.                                                                                                                                                                                                                        |

### 4.2 Candidate Knowledge Base (KB)

| ID    | Requirement                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KB-01 | The candidate creates a knowledge base about themselves: personal info, career data, work history, skills, certificates, hobbies, and so on. Markdown (`.md`) is supported. |
| KB-02 | The candidate can upload writing samples, such as past applications with their job descriptions, so the system can match their tone.                                        |
| KB-03 | Supported upload types are `.txt`, `.md`, `.html`, `.doc`/`.docx`, and `.pdf`, up to **50 MB (50,000,000 bytes) per file** (the knowledge base limit).                      |
| KB-04 | Files upload directly to S3 (presigned upload).                                                                                                                             |
| KB-05 | Knowledge base documents are indexed for retrieval (RAG). Retrieval returns only the owning candidate's documents.                                                          |
| KB-06 | Each candidate can store up to **50 MB (50,000,000 bytes)** and **100 documents** in total. An admin can change this for a specific candidate.                              |

### 4.3 Application Generation (GEN)

| ID     | Requirement                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GEN-01 | The candidate provides a job description (JD), as text or as a link to a public job post that loads without signing in (for example Seek). |
| GEN-02 | The candidate can add optional requirements, such as page count or skills to emphasise.                                                    |
| GEN-03 | The system produces a CV and a cover letter as **separate documents**. The system suggests which to produce, or the candidate chooses.     |
| GEN-04 | Generation runs **asynchronously**.                                                                                                        |
| GEN-05 | The candidate refines the result through a **conversation** before exporting.                                                              |
| GEN-06 | The final documents can be exported to PDF. **Exported files are not stored.**                                                             |
| GEN-07 | The candidate can provide the JD as a file: `.doc`/`.docx`, `.pdf`, or an image (`.png`, `.jpeg`, `.gif`, `.webp`).                        |

### 4.4 Personal Chatbot (CHAT)

| ID      | Requirement                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHAT-01 | The candidate can turn their personal chatbot on or off.                                                                                                              |
| CHAT-02 | Each candidate has a chatbot page, for example `/chat-with/<id>`.                                                                                                     |
| CHAT-03 | A headhunter can submit a JD and get a match assessment for the candidate.                                                                                            |
| CHAT-04 | A headhunter can ask questions about the candidate. The chatbot represents the candidate.                                                                             |
| CHAT-05 | Each headhunter has their own token quota.                                                                                                                            |
| CHAT-06 | A candidate can create a **coupon** linked to a specific application. With the coupon, the chatbot tailors answers to that JD and the headhunter gets a higher quota. |
| CHAT-07 | Chat responses are **synchronous**.                                                                                                                                   |

### 4.5 Quota (QUOTA)

| ID       | Requirement                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| QUOTA-01 | Quota is measured in USD of model usage, calculated from each call's token counts and the model's price.                                                                                                                                   |
| QUOTA-02 | Quotas reset both **daily** and **monthly**, at 00:00 UTC.                                                                                                                                                                                 |
| QUOTA-03 | Quota differs by role. A candidate gets USD 0.10 per day and USD 0.50 per month. Admins (Cognito `admin` group) get USD 1 per day and USD 5 per month. Tiers (for example unverified, verified, or coupon holder) come in a later release. |
| QUOTA-04 | There is a maximum token count per request.                                                                                                                                                                                                |

### 4.6 Admin (ADMIN)

| ID       | Requirement                                                        |
| -------- | ------------------------------------------------------------------ |
| ADMIN-01 | Admin features start simple.                                       |
| ADMIN-02 | An admin can set the quota for a specific candidate or headhunter. |
| ADMIN-03 | An admin can use a **kill switch** that turns off all AI calls.    |

---

## 5. AI Agent System

### 5.1 Golden rule

> **The agent never invents experience, skills, or any fact that is not in the candidate's own documents.**

### 5.2 Flows

| Flow                            | Used by    | Mode  |
| ------------------------------- | ---------- | ----- |
| Generate CV and cover letter    | Candidate  | Async |
| JD-to-candidate match score     | Headhunter | Sync  |
| Chatbot Q&A about the candidate | Headhunter | Sync  |

### 5.3 Initial multi-agent design

```text
JD Analyzer → Profile Matcher → ┬→ CV Writer ───────────┬→ Style Agent → Reviewer / Critic
                                └→ Cover Letter Writer ─┘

Chatbot Agent (separate flow)
```

| Agent                           | Responsibility                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| JD Analyzer                     | Pulls out the requirements, skills, and keywords from the JD.                                 |
| Profile Matcher                 | Finds evidence for each requirement in the candidate's knowledge base (RAG).                  |
| CV Writer / Cover Letter Writer | Drafts each document from the matched evidence only.                                          |
| Style Agent                     | Matches the candidate's tone, using their writing samples.                                    |
| Reviewer / Critic               | Checks for fabrication, JD coverage, and quality. Sends drafts back for revision when needed. |
| Chatbot Agent                   | Answers headhunter questions within safety and privacy rules.                                 |

The design will be refined during implementation. It will use **different models depending on how complex each task is**.

### 5.4 Technology

- **Runtime:** Python 3.12, LangChain, LangGraph
- **Platform:** AWS Bedrock AgentCore

| AgentCore / Bedrock feature       | Purpose                                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                           | Hosts the agents.                                                                                                                                                     |
| Memory (short-term and long-term) | Keeps conversation context and candidate preferences.                                                                                                                 |
| Gateway                           | Exposes tools to the agents.                                                                                                                                          |
| Observability                     | Provides tracing, metrics, and debugging.                                                                                                                             |
| Browser                           | Loads JDs from public job sites.                                                                                                                                      |
| Evaluations                       | Runs quality benchmarks on agent output.                                                                                                                              |
| Policy                            | Controls which actions agents are allowed to take.                                                                                                                    |
| Bedrock Guardrails                | Filters input and output for safety.                                                                                                                                  |
| Knowledge base (RAG, S3 source)   | Retrieves facts from candidate documents. Bedrock Managed Knowledge Base, with document-level ACLs per candidate ([ADR-0007](docs/adr/0007-knowledge-base-store.md)). |

Not used: Code Interpreter, Identity.

### 5.5 Evaluation

An **evaluation benchmark** is required. It measures output quality and checks the golden rule, and it runs as part of the delivery process.

---

## 6. AI Safety Requirements

| ID      | Risk                  | Example                                                                        | Requirement                                                                                                       |
| ------- | --------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| SAFE-01 | Prompt injection      | A JD contains hidden instructions.                                             | Treat all external content as untrusted data, never as instructions.                                              |
| SAFE-02 | Jailbreak / data leak | A headhunter tries to get private data or make the chatbot say harmful things. | The chatbot shares only data the candidate allows and resists jailbreak attempts.                                 |
| SAFE-03 | Fabrication           | The CV claims a skill the candidate does not have.                             | Every claim must trace back to the candidate's documents. The Reviewer and the evaluation benchmark enforce this. |
| SAFE-04 | PII exposure          | Personal data appears in logs, memory, or model inputs.                        | Minimise PII and redact it in logs and memory.                                                                    |
| SAFE-05 | Toxic output          | Harmful or unsafe content.                                                     | Refuse to answer. Guardrails apply to both input and output.                                                      |

---

## 7. Architecture

| Layer                  | Technology                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend               | Vite, React, TypeScript SPA, Tailwind CSS, served via CloudFront                                                                                                                                                            |
| API                    | AWS API Gateway REST API, with a Cognito authorizer that accepts access tokens only ([ADR-0009](docs/adr/0009-sign-in-and-api-access.md))                                                                                   |
| Backend                | Node.js 24, TypeScript, AWS Lambda (serverless)                                                                                                                                                                             |
| Database               | Amazon DynamoDB, a single table with an `Entity` attribute ([ADR-0006](docs/adr/0006-data-store.md))                                                                                                                        |
| File storage           | Amazon S3 (direct upload)                                                                                                                                                                                                   |
| Auth                   | Amazon Cognito (Essentials plan): managed login, email/password and Google sign-in with account linking, authorization code flow with PKCE ([ADR-0009](docs/adr/0009-sign-in-and-api-access.md))                            |
| AI agents              | Python 3.12, LangChain, LangGraph on Bedrock AgentCore                                                                                                                                                                      |
| Infrastructure as Code | OpenTofu (HCL), with encrypted remote state per environment and stack ([ADR-0013](docs/adr/0013-infrastructure-as-code-opentofu.md))                                                                                        |
| CI/CD                  | GitHub Actions (actions pinned to commit SHAs, updated by Dependabot)                                                                                                                                                       |
| Package managers       | pnpm (via Corepack) for TypeScript, uv for Python                                                                                                                                                                           |
| Repository             | Monorepo: pnpm workspaces with pnpm's built-in task orchestration, plus `package.json` wrappers so pnpm can run the Python service's and the infrastructure's tasks ([ADR-0001](docs/adr/0001-monorepo-pnpm-workspaces.md)) |
| Contracts              | Zod schemas are the single source of truth for API ↔ agent payloads. JSON Schema and Pydantic models are generated from them, committed, and checked in CI ([ADR-0003](docs/adr/0003-contracts-codegen.md))                 |
| Secrets                | SSM Parameter Store; Secrets Manager when needed                                                                                                                                                                            |

**Backend-to-agent communication:** synchronous for chat, asynchronous for long-running generation.

---

## 8. Security and Cost Controls

The system must resist abuse, such as someone creating many free accounts to collect more quota. Controls are added step by step, from simple to layered:

| Control                        | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| Email verification             | Unlocks a higher quota.                        |
| CAPTCHA (Cloudflare Turnstile) | Blocks automated sign-ups.                     |
| API Gateway usage plans        | Rate limiting and throttling.                  |
| Per-user token quota           | Limits AI usage per user.                      |
| Max tokens per request         | Limits the cost of a single call.              |
| AWS Budgets alarms             | Monthly budget limit **for each environment**. |
| Kill switch                    | Turns off all AI calls immediately.            |

---

## 9. Non-Functional Requirements

| Area          | Target                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability  | 99.9% in production                                                                                                                                                        |
| Scale         | Low user volume (portfolio stage)                                                                                                                                          |
| Reliability   | Production-grade behaviour, with errors handled and observable                                                                                                             |
| Test coverage | 80% minimum per TypeScript and Python package (lines, statements, functions, branches), enforced in CI. Infrastructure is checked with `tofu test`, `tflint`, and `trivy`. |
| User focus    | New Zealand and Australia, served from `us-east-1` (see §10)                                                                                                               |

---

## 10. Environments and Delivery

| Item           | Decision                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environments   | `dev`, `stag`, `prod`, each in a separate AWS account under AWS Organizations, with a shared log archive account ([ADR-0004](docs/adr/0004-accounts-and-access.md))                          |
| Account access | Humans use IAM Identity Center (SSO). CI uses GitHub OIDC. No long-lived AWS keys ([ADR-0004](docs/adr/0004-accounts-and-access.md))                                                         |
| Guardrails     | Service control policies and an organization CloudTrail trail ([ADR-0004](docs/adr/0004-accounts-and-access.md))                                                                             |
| Region         | Single region, `us-east-1`, for every environment ([ADR-0002](docs/adr/0002-aws-region.md))                                                                                                  |
| Domain         | `cv.ikiwii.com` (`prod`), `stag.cv.ikiwii.com`, and `dev.cv.ikiwii.com`, each a Route 53 zone in its own account, delegated from the registrar ([ADR-0008](docs/adr/0008-domain-and-dns.md)) |
| Deployment     | OpenTofu through GitHub Actions                                                                                                                                                              |
| Process        | Lightweight Agile/Scrum in small sprints                                                                                                                                                     |
| Sprint docs    | `docs/sprints/`                                                                                                                                                                              |

---

## 11. Out of Scope (Current Stage)

- Storing exported PDF files
- AgentCore Code Interpreter and Identity

---

## 12. MVP Scope

The first release covers the candidate flow end to end. The reasons, the options compared, and the sprint order are in [ADR-0005](docs/adr/0005-mvp-scope.md).

### In the MVP

| Feature                                              | Requirement IDs                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Sign-in (email/password, Google) and sign-up CAPTCHA | AUTH-01, AUTH-02, §8 (CAPTCHA)                                                             |
| Cost guards and quota                                | ADMIN-01, ADMIN-02, ADMIN-03, QUOTA-01, QUOTA-02, QUOTA-03 (candidate and admin), QUOTA-04 |
| Knowledge base                                       | KB-01, KB-03, KB-04, KB-05, KB-06                                                          |
| CV and cover letter generation                       | GEN-01, GEN-02, GEN-03, GEN-04, GEN-07, SAFE-01, SAFE-03, SAFE-04, SAFE-05, §5.5           |
| Style matching                                       | KB-02                                                                                      |
| PDF export                                           | GEN-06                                                                                     |
| Release to `prod` at `cv.ikiwii.com`                 | §10                                                                                        |

### Later releases, in order

1. Refinement conversation (GEN-05)
2. Tiers and abuse controls (AUTH-03, QUOTA-03 tiers, §8 except CAPTCHA)
3. Personal chatbot (CHAT-01 to CHAT-05, CHAT-07, SAFE-02)
4. Coupons (CHAT-06)
5. Extra credit beyond the free quota

# ADR-0005: MVP Scope

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-10-01    |
| Deciders    | Project owner |
| Sprint item | S1-13         |

## Context

`AGENTS.md` §4 lists every functional requirement, and §6 lists the safety requirements. Building all of them before the first release would take many sprints and would delay feedback on the core idea. The first release (the MVP) needs a clear scope, an order, and a list of what comes later, so Sprint 2 feature work can start.

The work is grouped into **feature slices**. Each slice is a vertical piece of the product (UI, API, data, and agents together) that can be built, tested, and shown on its own.

### Decision drivers

1. **Deliver the core promise end to end:** a candidate builds a knowledge base and gets a tailored CV and cover letter for a job.
2. **Show the golden rule with evidence** (`AGENTS.md` §5.1): the Reviewer and the evaluation benchmark (§5.5, SAFE-03) are part of the first release, not added later.
3. **Control spend before any public AI call:** the kill switch, the per-request token limit, and the quota exist before AI features are exposed.
4. **Release in about 5 one-week sprints** (Sprints 2–6).
5. **Leave the hardest product questions for later:** headhunter access to the chatbot, headhunter quotas, and paid credit need more research and don't block the core flow.

### Feature slices

Every requirement ID in `AGENTS.md` §4 and §6 belongs to exactly one slice. A requirement split across two slices names the part each slice covers.

| Slice | Name                    | Contents                                                                                                                                                                                                             | Requirement IDs                                                                            |
| ----- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A     | Walking skeleton + auth | DNS and certificates on `ikiwii.com` ([ADR-0008](0008-domain-and-dns.md)), SPA on CloudFront, API Gateway with a Cognito authorizer, email/password and Google sign-in, account linking, `admin` group, first tables | AUTH-01, AUTH-02                                                                           |
| B     | Cost guards             | Kill switch, max tokens per request, usage metered in USD, daily and monthly quota, admin quota, per-user override set by script                                                                                     | ADMIN-01, ADMIN-02, ADMIN-03, QUOTA-01, QUOTA-02, QUOTA-03 (candidate and admin), QUOTA-04 |
| C     | Knowledge base          | Markdown content, presigned upload with a per-document ACL file, managed knowledge base sync, storage cap                                                                                                            | KB-01, KB-03, KB-04, KB-05, KB-06                                                          |
| D     | Generation core         | JD as text, options, CV and cover letter as separate documents, async; JD Analyzer → Profile Matcher → Writers → Reviewer; Guardrails; PII redaction; evaluation benchmark                                           | GEN-01 (text), GEN-02, GEN-03, GEN-04, SAFE-01, SAFE-03, SAFE-04, SAFE-05, §5.5            |
| E     | PDF export              | Export the final documents to PDF, not stored                                                                                                                                                                        | GEN-06                                                                                     |
| F     | Style matching          | Writing samples upload and the Style Agent                                                                                                                                                                           | KB-02                                                                                      |
| G     | Refinement conversation | Refine a draft through chat before export (AgentCore Memory)                                                                                                                                                         | GEN-05                                                                                     |
| H     | JD from a link or file  | Public job post links (AgentCore Browser) and JD files (documents and images)                                                                                                                                        | GEN-01 (link), GEN-07                                                                      |
| I     | Tiers and abuse         | Verification tier, CAPTCHA, API Gateway usage plans                                                                                                                                                                  | AUTH-03, QUOTA-03 (tiers), §8                                                              |
| J     | Personal chatbot        | Chatbot on/off, chatbot page, match score, Q&A, per-headhunter quota, jailbreak and data-leak protection                                                                                                             | CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-07, SAFE-02                              |
| K     | Coupons                 | Coupons linked to an application                                                                                                                                                                                     | CHAT-06                                                                                    |
| L     | Extra credit            | A way to get quota beyond the free amount                                                                                                                                                                            | Quota epic (no ID yet)                                                                     |
| R     | Release path            | `stag` and `prod` promotion pipeline, the first `prod` deploy at `cv.ikiwii.com`, service checks in `stag` and `prod`                                                                                                | §10                                                                                        |

Slice R has no requirement ID of its own, but nothing can be released without it.

## Options Considered

### Option 1: Candidate core (A, B, C, D, E, R)

- **Pros:** delivers the main promise and the golden-rule evidence. Every AI call sits behind sign-in and quota. Defers the chatbot access design, the hardest open product question.
- **Cons:** no headhunter-facing feature at launch. Without style matching, drafts may sound generic.

### Option 2: Both flows, thin (A, B, C, a CV-only D, J without match score and headhunter quota, R)

- **Pros:** proves both the async (generation) and the sync (chat) paths in `AGENTS.md` §7, and shows the chatbot.
- **Cons:** the chatbot access design and headhunter quotas must be decided in Sprint 2. Two agent flows and an unauthenticated public endpoint are built at the same time. There is no cover letter and no PDF export.

Rejected, because it fails drivers 3 and 5, and each part ends up thinner.

### Option 3: Chatbot first (A, B, C, J, R)

- **Pros:** a single RAG agent is the simplest agent to build. A shareable chatbot link is an easy demo.
- **Cons:** the multi-agent generation, which is the core product and the main AgentCore showcase, comes after the MVP. The first public AI endpoint needs no sign-in, which is the highest abuse risk before the tier and abuse controls exist.

Rejected, because it fails drivers 1, 2, and 3.

## Decision

**Option 1, extended with style matching (F) and JD input from a link or a file (H).** Style matching is what makes a draft sound like the candidate, and a JD often arrives as a link or a file, so both are part of the core promise.

### MVP

| Slice | Notes                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Google is the first OAuth provider. LinkedIn joins the MVP only if a time-boxed spike shows it works as a Cognito OIDC provider without a proxy or custom code. |
| B     | Candidate: USD 0.10 per day and USD 0.50 per month. Admin: USD 1 per day and USD 5 per month.                                                                   |
| C     | Storage cap: 50 MB per candidate.                                                                                                                               |
| D     | A full generation must cost USD 0.10 or less, so it fits a candidate's daily quota.                                                                             |
| E     | —                                                                                                                                                               |
| F     | —                                                                                                                                                               |
| H     | Links: public pages only, meaning pages that load without signing in. Files: `.doc`/`.docx`, `.pdf`, and images (`.png`, `.jpeg`, `.gif`, `.webp`).             |
| R     | `prod` is served at `cv.ikiwii.com`, `stag` at `stag.cv.ikiwii.com`, and `dev` at `dev.cv.ikiwii.com` ([ADR-0008](0008-domain-and-dns.md)).                     |

### Order

| Sprint | Slices                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2      | A (including DNS on `dev.cv.ikiwii.com`, Google sign-in, and account linking), the kill switch and max tokens part of B, the knowledge base spike, the LinkedIn spike |
| 3      | C, plus a first JD Analyzer on a JD given as text, behind the kill switch                                                                                             |
| 4      | D: the full agent graph, the Reviewer, and the evaluation benchmark in CI                                                                                             |
| 5      | F and H                                                                                                                                                               |
| 6      | The rest of B (quota), E, R, hardening, and the first `prod` release                                                                                                  |

The kill switch and the per-request token limit come in Sprint 2, before the first AI call in Sprint 3. The full quota comes in Sprint 6, before the first `prod` release. Until then, AI features run only in `dev`, where the budget alarms and the emergency deny SCP apply.

### Later releases, in order

1. G: refinement conversation
2. I: tiers and abuse controls, and LinkedIn sign-in if it was deferred
3. J: personal chatbot
4. K: coupons
5. L: extra credit

## Consequences

### Positive

- The first release proves the core product, the golden rule, and the multi-agent design on AgentCore.
- Every AI call in the MVP is behind sign-in, the kill switch, a per-request limit, and a quota.
- The open questions about headhunter access and paid credit don't block Sprint 2.

### Negative

- No headhunter-facing feature at launch.
- The MVP takes about 5 sprints instead of 3–4, because style matching and JD links and files are included.
- The USD 0.10 per generation target limits model choice to smaller models with prompt caching.

### Risks and mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A generation costs more than USD 0.10.                                                     | The evaluation benchmark records cost per generation from Sprint 4. Model choice, prompt caching, and the Reviewer's revision limit are tuned against it.                   |
| A job site needs sign-in or blocks automated access (for example some LinkedIn job pages). | The agent fetches only the single page the candidate supplied, on their request. When a page can't be read, the UI asks the candidate to paste the text or upload the file. |
| A JD (text, page, file, or image) contains hidden instructions.                            | Every JD source is untrusted data (SAFE-01). Images and PDFs are treated the same as text.                                                                                  |
| Sprints 2–6 run over.                                                                      | Each sprint names the item that moves first. Slice R is never cut: the MVP is not released without it.                                                                      |

### When to revisit this decision

- A sprint review shows the MVP will need more than 6 sprints: cut H's file input first, then F.
- Real users ask for the chatbot before launch: move J ahead of G.

## Verification

1. Every requirement ID in `AGENTS.md` §4 and §6 appears in exactly one row of the slice table:

   ```bash
   for id in $(grep -oE '\b(AUTH|KB|GEN|CHAT|QUOTA|ADMIN|SAFE)-[0-9]{2}\b' AGENTS.md | sort -u); do
     grep -q "$id" docs/adr/0005-mvp-scope.md || echo "missing: $id"
   done
   ```

   This prints nothing.

2. `AGENTS.md` §12 lists the same MVP slices and the same order of later releases as this ADR.

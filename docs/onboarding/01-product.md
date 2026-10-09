# 01 The Product

**Time:** 3 hours · **Week:** 1 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `2e9e051`

## Goal

Explain what CV Tailor does, who it's for, and its golden rule. Know where decisions are written down, and how to read them.

## Before you start

- [00 Rules](00-rules.md) done.

## Learn first

Nothing new. This module is reading.

## Read

1. [`README.md`](../../README.md), the one-page summary. Look for: the five layers in the Architecture table, and the repository layout.
2. [`AGENTS.md`](../../AGENTS.md), the product's source of truth, in this order:
   - §2 Product overview and §3 Roles. Look for: the problem, and the three roles.
   - §4 Functional requirements. Look for: the ID format, such as `KB-06` or `GEN-04`. Code comments cite these IDs, so you'll meet them again.
   - §5 AI agent system. Look for: §5.1, the golden rule, and the agent pipeline in §5.3. §5.3 is the design; the current sprint doc says which parts exist.
   - §6 AI safety requirements. Look for: SAFE-01 to SAFE-05, especially SAFE-04: no personal data in logs.
   - §7 Architecture and §12 MVP scope: skim them.
3. [ADR-0005: MVP scope](../adr/0005-mvp-scope.md), the first architecture decision record (ADR) you read in full. Look for: the parts in the table below, and the "Order" section, which says what each sprint builds.
4. The current sprint doc, the highest number in [`docs/sprints/`](../sprints/). Look for: the sprint goal, the backlog, and "Sprint Review → Done", which says what is built so far.

### How to read an ADR

An ADR records one decision: why it was needed, the options, the choice, and its trade-offs. Every ADR in [`docs/adr/`](../adr/) has the same parts:

| Part                         | What it tells you                                                    |
| ---------------------------- | -------------------------------------------------------------------- |
| Header table                 | Status (Proposed or Accepted), date, sprint item, and any amendments |
| Context and decision drivers | The problem, and what a good answer must do                          |
| Options considered           | Each option with its pros and cons, and why it was rejected          |
| Decision                     | What was chosen, in detail                                           |
| Consequences                 | What gets better, what gets worse, the risks, and when to revisit it |
| Verification                 | How to check that the decision was carried out                       |

An "Amended" entry in the header means the decision changed later. The text you read already includes the change.

### How to read a sprint doc

| Part            | What it tells you                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Sprint goal     | One sentence: what is true at the end of the sprint                                             |
| Backlog         | Items with an ID such as `S3-07`, the requirement IDs they serve, and their acceptance criteria |
| Execution guide | The order of the work, who does each step, how, and how it's verified                           |
| Out of scope    | What was left out on purpose                                                                    |
| Risks           | What could go wrong, and what reduces it                                                        |
| Sprint review   | What was done and not done, what changed and why, and lessons learned                           |

The "Lessons learned" lists are the best place to learn how this project really works.

## Do

### P1 Requirement hunt `[No AWS]`

Find where a requirement lives in the code:

```bash
git grep -n "KB-06" -- ':!docs'
```

`git grep` searches the files git tracks. `-- ':!docs'` leaves out the `docs` folder.

Expected: lines in `AGENTS.md`; `packages/contracts/src/documents.ts`, which sets the 50 MB limit; `apps/api/src/data/documents.ts`; and tests such as `apps/api/test/documents/service.test.ts`.

Now do the same for `ADMIN-03` and `SAFE-04`. For each ID, write in `notes.local/product.md` one code file, one test or infrastructure file, and one sentence about what that code does for the requirement.

### P2 Read an ADR like an engineer `[No AWS]`

Open [ADR-0006](../adr/0006-data-store.md). Find each part from the ADR table above. Then write one sentence in your notes: "We chose ___ because ___, and we accepted ___."

### P3 Lessons learned `[No AWS]`

Read the "Lessons learned" list in the [Sprint 2 review](../sprints/sprint-02-walking-skeleton.md#sprint-review). Pick three that surprise you. For each one, write down what happened and what the project does differently because of it.

### P4 Look at the product `[No AWS]`

Open [https://dev.cv.ikiwii.com](https://dev.cv.ikiwii.com) in your browser and look around. Don't sign up yet. You'll do that in [03 Setup](03-setup.md), with your mentor's OK.

## Verify

Without notes, in two minutes, you can explain: the problem, the users, the golden rule, and what the current sprint is building.

## Check your understanding

1. What is the golden rule, and what is meant to enforce it?

   <details>
   <summary>Answer</summary>

   `AGENTS.md` §5.1: the agent never invents experience, skills, or any fact that isn't in the candidate's own documents. SAFE-03 says every claim must trace back to those documents. The Reviewer agent and the evaluation benchmark (§5.5) enforce it.

   </details>

2. Where is KB-06 enforced?

   <details>
   <summary>Answer</summary>

   `STORAGE_LIMIT_BYTES` and `MAX_DOCUMENTS` in `packages/contracts/src/documents.ts` set the limits. The API enforces them in one DynamoDB transaction when it reserves space for a document (`apps/api/src/data/documents.ts`), so two uploads at the same time can't both pass the limit.

   </details>

3. Why does generation run asynchronously, but chat synchronously?

   <details>
   <summary>Answer</summary>

   GEN-04 and CHAT-07. `AGENTS.md` §7: generation is long-running, because several agents work on one CV, so the person can't wait on one open request. A chat answer is short, and the person waits for it. ADR-0010 designs the asynchronous part.

   </details>

4. You want to know why the project uses a single DynamoDB table. Where do you look?

   <details>
   <summary>Answer</summary>

   ADR-0006. In general: ADRs for decisions; sprint reviews for "What changed and why" and "Lessons learned"; then commit messages and pull requests.

   </details>

5. What does an "Amended" entry in an ADR's header mean?

   <details>
   <summary>Answer</summary>

   The decision was changed after it was accepted. The entry gives the date and what changed, and the ADR's text already includes the change.

   </details>

## If you get stuck

- A word you don't know: see the [glossary](glossary.md).
- A requirement seems to contradict the code: write it down and ask your mentor. You may have found a real problem.

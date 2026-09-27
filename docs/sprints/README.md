# Sprints

This project uses a lightweight Agile/Scrum process, with small **1-week sprints**.

## Files

- One file per sprint: `sprint-NN-<slug>.md`, for example `sprint-00-foundation.md`.
- Architecture decisions made during a sprint are recorded as ADRs in [`docs/adr/`](../adr/).
- Backlog items refer to requirement IDs in [`AGENTS.md`](../../AGENTS.md), for example `GEN-03` or `SAFE-02`.

## Owner legend

Each step in a sprint's execution guide has an owner:

| Owner | Meaning |
| --- | --- |
| **Me** | I do it by hand. It needs my accounts, a decision from me, or it's something new to me and I want to learn by doing. |
| **Me + Claude** | Claude gives exact files and commands for this step, and I implement and verify them. |
| **Claude** | Claude does it (research, drafting, time-consuming work), and I review before merging. |
| **Claude drafts, Me decides** | Claude prepares options or a draft, and I make the decision. |

Nothing is merged without my review. See `AGENTS.md` §1.

## Git flow

For every step:

1. `git switch -c s<sprint>/<item-id>-<slug>`, for example `s0/03-root-workspace`
2. Commit and push
3. Open a PR and check that CI passes
4. Merge into `main`

## Definition of Done (all sprints)

- The code is merged to `main` through a PR with green CI.
- Every acceptance criterion in the sprint doc is met and verified.
- New decisions are recorded as ADRs, and `AGENTS.md` is updated.
- Tests are included for new code. The coverage target is 80% once coverage gates are enabled.
- The sprint review section is filled in.

## Sprint doc template

```markdown
# Sprint NN: <Name>

**Sprint goal:** <one sentence>
**Dates:** YYYY-MM-DD to YYYY-MM-DD
**Status:** Planned | In progress | Done

## Backlog

| ID | Item | Requirement IDs | Acceptance criteria |
| --- | --- | --- | --- |

## Execution guide

| # | Step | Item | Owner | How | Verify |
| --- | --- | --- | --- | --- | --- |

## Out of scope

## Risks

## Sprint review

- **Done:**
- **Not done / carried over:**
- **What changed and why:**
- **Lessons learned:**
- **Next sprint backlog:**
```

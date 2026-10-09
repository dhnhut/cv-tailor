# Onboarding Guide

Welcome to CV Tailor. This guide takes you from your first day to your first merged pull request in about four weeks. Follow it in order. Every step says what to do, what you should see, and what to do if you don't see it.

**Who it's for:** a junior developer who can already write small programs, for example from university, but hasn't worked on a professional codebase yet. You don't need to know TypeScript, React, Python, or AWS. The guide tells you what to learn, and when.

**By the end, you can:**

- explain what CV Tailor does, who uses it, and its golden rule;
- set up the project and run every check on your own computer;
- follow one request, `GET /me`, from the browser through the API and the database and back;
- read and test the infrastructure without touching AWS;
- open a pull request that passes CI, answer the review, and see it deployed.

## How to use this guide

- **One module at a time, in order.** Each module builds on the one before it.
- **Every module has the same parts:** Goal, Before you start, Learn first, Read, Do, Verify, Check your understanding, and If you get stuck.
- **Learn just in time.** [02 Learning path](02-learning-path.md) lists a tutorial for each technology. Each module tells you which part you need that day. Don't read every tutorial in week 1.
- **Predict, then run.** Before each command, write down what you expect. Then run it and compare. A wrong guess is where you learn the most.
- **Keep notes** in a `notes.local/` folder at the repository root. Git ignores it (the `*.local` rule in `.gitignore`), so your notes stay on your computer.
- **Ask after 30 minutes.** If you're stuck for 30 minutes, ask for help (see [Getting help](#getting-help)).

## Safety tags

Every exercise has a tag that says what it touches:

| Tag              | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `[No AWS]`       | Runs only on your computer. Safe to repeat.                                                              |
| `[Dev sign-in]`  | Uses the deployed `dev` website with your own test account. Needs no AWS access.                         |
| `[RO AWS]`       | Uses your read-only AWS access to `dev`, the `cvt-dev-ro` profile (week 3). It can't change anything.    |
| `[GitHub write]` | Pushes a branch or opens a pull request. Anyone can see it, because the repository is public. Ask first. |

[00 Rules](00-rules.md) lists what you never do.

## The practice routine

Many exercises ask you to change code on purpose, watch a check fail, and then undo the change. Always do this on a practice branch, from the repository root:

```bash
# 1. Start from an up-to-date main, on a new practice branch.
git switch main
git pull --ff-only
git switch -c practice/05-contracts        # practice/<module>-<topic>

# 2. Make the change. Write your prediction in notes.local/. Run the command. Compare.

# 3. Undo every change, then delete the branch.
git restore --staged --worktree -- .
git clean -n                                # lists files you created; delete only those
git switch main
git branch -D practice/05-contracts
```

`git status` must say `nothing to commit, working tree clean` at the end. Never run `git clean -x`: it also deletes ignored folders such as `node_modules`, `.venv`, and your `notes.local`.

## Schedule

About 6 hours a day for four weeks. "LP" means a topic in [02 Learning path](02-learning-path.md).

| Day | Do                                                                                                                                    | Hours |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Kickoff with your mentor (1) · this page and [00 Rules](00-rules.md) (1.5) · [01 The product](01-product.md) (2) · LP terminal (1.5)  | 6     |
| 2   | [03 Setup](03-setup.md) to the first green `pnpm run check` (4) · LP Git (2)                                                          | 6     |
| 3   | 03: the web app and your `dev` account, and the AI tutor from 00 (1.5) · [04 Repo tour](04-repo-tour.md) (2.5) · LP HTTP and JSON (2) | 6     |
| 4   | LP TypeScript (4) · 04 exercises (2)                                                                                                  | 6     |
| 5   | LP TypeScript narrowing (2) and Vitest (2) · week 1 check-in (1) · catch up (1)                                                       | 6     |
| 6   | LP Zod (1) · [05 Contracts](05-contracts.md) (4) · notes (1)                                                                          | 6     |
| 7   | LP Lambda and DynamoDB (2) · [06 API](06-api.md): reading and first exercises (4)                                                     | 6     |
| 8   | 06 API: the other exercises and the document API (5) · notes (1)                                                                      | 6     |
| 9   | LP React (3) and OAuth with PKCE (2) · [07 Web](07-web.md): reading (1)                                                               | 6     |
| 10  | 07 Web: exercises (4) · week 2 check-in (1)                                                                                           | 5     |
| 11  | [08 Request flow](08-request-flow.md) (4) · LP Python (2)                                                                             | 6     |
| 12  | LP pytest (1) · [09 Agents](09-agents.md) (4) · catch up (1)                                                                          | 6     |
| 13  | LP AWS (3) and infrastructure as code (1) · [10 Infrastructure](10-infrastructure.md): reading (2)                                    | 6     |
| 14  | 10 exercises (3.5) · [11 CI/CD](11-ci-cd.md), with a practice pull request (2.5)                                                      | 6     |
| 15  | AWS sign-in with your mentor (1) · [12 Explore dev](12-explore-dev.md) (3.5) · week 3 check-in (1)                                    | 5.5   |
| 16  | [13 First contribution](13-first-contribution.md): choose the task with your mentor (0.5) · write your plan (1.5) · start (3)         | 5     |
| 17  | Code and tests (5) · review your own change (1)                                                                                       | 6     |
| 18  | Open the pull request and answer the review (4) · read one or two of your mentor's merged pull requests (1)                           | 5     |
| 19  | After the merge: check the `main` run and `dev` (1) · a pull request that improves this guide (3)                                     | 4     |
| 20  | Teach back to your mentor (1) · retrospective (0.5) · plan the next month                                                             | 2+    |

If a day takes longer, that's fine. The order matters more than the dates.

## Progress checklist

Copy this list into `notes.local/progress.md` and tick items as you go.

```markdown
- [ ] 00 Rules, and the AI tutor set up
- [ ] 01 The product
- [ ] 03 Setup: `pnpm run check` passes, and I signed in on localhost
- [ ] 04 Repo tour
- [ ] 05 Contracts
- [ ] 06 API
- [ ] 07 Web
- [ ] 08 Request flow
- [ ] 09 Agents
- [ ] 10 Infrastructure
- [ ] 11 CI/CD, with a practice pull request
- [ ] 12 Explore dev, with read-only AWS access
- [ ] 13 First contribution merged
- [ ] A pull request that improves this guide
```

## Getting help

1. **Try for 30 minutes.** Read the whole error message. Search the repository (`git grep`). Check [troubleshooting](troubleshooting.md). Ask your AI tutor to explain the error.
2. **Then ask your mentor,** in the channel they give you. Write your question so it can be answered without a call:

   ```text
   What I'm trying to do:
   What I ran (the exact command):
   What I expected:
   What happened (the exact output, copied as text):
   What I tried:
   ```

3. **Never paste a token or a password anywhere.** Never post account IDs or personal data in public places, such as GitHub issues and pull requests.

There are no stupid questions. A question you ask in week 1 saves a day in week 3.

## For the mentor

| When               | What                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before day 1       | Decide which Claude account the junior uses. Agree on a help channel. Prepare 2 or 3 small starter tasks as sprint backlog items (module 13).                                                                           |
| Day 1              | Kickoff: walk through this page and [00 Rules](00-rules.md). Check that their GitHub account has two-factor authentication and commits with the noreply email. Invite them as a collaborator (Write), now or in week 3. |
| Day 3              | Help them set up the AI tutor ([00 Rules](00-rules.md#your-ai-tutor)), and agree on their `dev` sign-up.                                                                                                                |
| End of week 2      | Give read-only access to `dev` with the [account access runbook §4](../runbooks/account-access.md#4-give-a-team-member-read-only-access-to-dev). Run its checks yourself with `cvt-dev-ro` first.                       |
| Every week         | A check-in of about an hour. The quiz answers are in this guide, so ask "why?" and "what if?" about their notes. That is the real check.                                                                                |
| Every pull request | Review within a day. You merge, not them.                                                                                                                                                                               |
| Week 4             | The teach-back, a retrospective, and their pull request that improves this guide.                                                                                                                                       |

Plan on 8 to 10 hours of your time over the four weeks. The schedule assumes about 30 hours of work a week, reviews within a day, access ready by the end of week 2, and a green `main`. If any of these doesn't hold, keep the same order over eight weeks.

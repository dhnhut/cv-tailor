# 13 First Contribution

**Time:** 12 hours or more, over week 4 · **Week:** 4 · **Safety:** `[GitHub write]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Make a real change the way this project works: plan it, build it with tests, open a pull request, answer the review, and see it deployed after your mentor merges it. Then improve this guide.

## Before you start

- Modules 00 to 12 done.
- Your mentor has given you a starter task: a backlog item with an ID, such as `S4-07`, in the current sprint doc.

## Read

1. [`docs/sprints/README.md`](../sprints/README.md): the git flow and the Definition of Done.
2. Your task's row in the current sprint doc: its acceptance criteria are what "done" means.
3. One or two of your mentor's recent merged pull requests on GitHub. Look for: how the description is written, and how each change is checked.

## Steps

### F1 Write a plan, and get it approved

Before any code, write this in `notes.local/plan.md` and send it to your mentor:

```markdown
Item: S4-07, <title> (requirement IDs: …)
Why: <the problem, in one or two sentences>
Files I'll change: <paths>
Tests I'll add or change: <paths, and what each checks>
How I'll verify it: <commands, and what I expect to see>
Questions: <anything you're unsure about>
```

A plan that's wrong costs five minutes to fix. Code that's wrong costs a day. Start only when your mentor says the plan is good.

### F2 Build it

```bash
git switch main && git pull --ff-only
git switch -c s4/07-<short-slug>
```

- Make small commits. Every message starts with the item ID: `S4-07 Use the shared log helpers in GET /me`.
- Write the test first when you can, and watch it fail before your change makes it pass.
- Ask your AI tutor to explain and review; you write the code ([00 Rules](00-rules.md#your-ai-tutor)).
- Before you push, run everything CI runs:

  ```bash
  pnpm run check && pnpm run contracts:check
  ```

- Review your own diff, line by line: `git diff main...HEAD`. Can you explain every line? Is there a debug print, a secret, or an unrelated change?

### F3 Open the pull request

```bash
git push -u origin HEAD
gh pr create --title "S4-07 <short title>" --body-file notes.local/pr.md
```

Write `notes.local/pr.md` first:

```markdown
<One paragraph: what this changes and why. Item S4-07; requirement IDs.>

## Changes

- <what changed, file by file or by area>

## Checks

- [ ] `pnpm run check` passes
- [ ] `pnpm run contracts:check` passes
- [ ] <the item's own verification, with the command and what you saw>

## AI help

<For example: "Claude explained DynamoDB condition expressions; I wrote the code and the tests.">

## Questions

<Anything you want the reviewer to look at closely>
```

Then watch CI: `gh pr checks --watch`. A red check is yours to fix: read the failing step's log first.

### F4 Answer the review

- Answer every comment. Fix it, or explain why not, politely. "Done in <commit>" is a good answer.
- Push new commits to the same branch. CI runs again.
- If `main` moved on and GitHub says your branch is out of date, bring it up to date:

  ```bash
  git fetch origin
  git rebase origin/main
  pnpm run check
  git push --force-with-lease
  ```

  `--force-with-lease` overwrites **your own** branch only if nobody else pushed to it. Never force-push `main` (GitHub refuses anyway).

- **Don't merge.** When the review is done and CI is green, tell your mentor. They merge.

### F5 After the merge

```bash
gh run list --branch main --limit 1
```

Expected: the run on `main` finishes with `completed success`, including `deploy-dev`. If your change can be seen in `dev`, see it: in the web app, or in the logs with your read-only access ([12 Explore dev](12-explore-dev.md)). Your mentor adds or confirms the item's "Done" entry in the sprint review.

### F6 Improve this guide

You've just used this guide with fresh eyes, which nobody else can do. Open a second pull request that fixes what confused you: a missing step, an unclear sentence, an expected output that didn't match, or a term to add to the [glossary](glossary.md). Update **Last checked** in the modules you checked.

## Verify

- Your pull request is merged, and the `main` run after it is green.
- Your guide-improvement pull request is open or merged.

## Definition of Done

Your change is done when all of these are true ([`docs/sprints/README.md`](../sprints/README.md#definition-of-done-all-sprints)):

- It's merged to `main` through a pull request with green CI.
- Every acceptance criterion of the item is met and verified.
- It has tests, and coverage stays at 80% or more.
- Any new decision is recorded (ask your mentor whether it needs an ADR).
- If it changes setup, commands, or how a request flows, this guide is updated.

## Check your understanding

1. GitHub says your branch is out of date with `main`. What do you do?

   <details>
   <summary>Answer</summary>

   `git fetch origin`, `git rebase origin/main`, fix any conflicts, run the checks again, then `git push --force-with-lease`.

   </details>

2. What goes in a pull request description?

   <details>
   <summary>Answer</summary>

   The item ID and requirement IDs, what changed and why, how you checked it, how AI helped, and your questions for the reviewer.

   </details>

3. A reviewer asks about a line you can't explain. What do you do?

   <details>
   <summary>Answer</summary>

   Say so honestly. Learn what it does, then keep it, change it, or remove it, and explain your choice. Never keep code you can't explain.

   </details>

4. When is your work done?

   <details>
   <summary>Answer</summary>

   When your mentor has merged it, the `main` run including `deploy-dev` is green, the change works in `dev` where it can be seen, and any docs it affects, this guide included, are updated.

   </details>

## If you get stuck

- `git rebase` stops with a conflict: open the files it names, keep the right lines, `git add` them, then `git rebase --continue`. Unsure? `git rebase --abort` puts everything back, then ask your mentor.
- CI fails on something your change didn't touch: check whether `main` is red too. If it is, tell your mentor.

# 00 Rules

**Time:** 1.5 hours · **Week:** 1 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `2e9e051`

## Goal

Know what you must never do, what to ask about first, and what you're free to do. Know how the team works, and set up your AI tutor.

## Before you start

- Read [the start page](README.md).

## Never

These rules protect real users, real money, and the project's security. If something seems to need an exception, stop and ask your mentor.

1. **Never commit a secret, token, password, account ID, or personal data,** yours or anyone else's. The repository is public, and git history is permanent: deleting a file later doesn't remove it from history. `infra/.env` holds account IDs and is ignored by git. Never force-add it.
2. **Never merge a pull request, not even your own.** Your mentor merges. Every merge to `main` deploys to `dev` straight away.
3. **Never run `infra/scripts/tofu.sh`, or any `tofu apply`, `destroy`, `import`, or `force-unlock`.** They change real infrastructure. `tofu test`, `tofu validate`, and `tofu fmt` are fine: they never reach AWS.
4. **Never use an AWS profile other than `cvt-dev-ro`.** If any other profile ever works for you, tell your mentor.
5. **Never change the kill switch** (`/cv-tailor/ai-calls`), and never run a script that calls an AI model, such as `services/agents/scripts/ai_guard_check.py`. AI calls cost money.
6. **Never put real personal data into `dev`:** no real CVs, no real job applications. `dev` holds test data only.
7. **In `dev`, read only your own data, by its key.** Never scan a table, never open the documents bucket, and never look up other users. Read-only access could read them. You don't.
8. **Never paste a token, a password, or someone's personal data** into an AI tool, an issue, a pull request, or a chat.
9. **Never edit generated files by hand:** `packages/contracts/schemas/`, `services/agents/src/cv_tailor_agents/contracts/`, and `infra/generated/`. Module 05 shows how they're made.
10. **Never run `git clean -x`, or `git reset --hard` with work you want to keep.** After a rebase, you'll push your own branch with `--force-with-lease` (module 13). Never force-push anything else.

## Ask first

- Signing up on `dev`. It creates a real user in a shared test user pool.
- Pushing a branch or opening a pull request, even a practice one.
- Changing anything in `infra/`, `.github/`, `docs/adr/`, or `AGENTS.md`.
- Adding a package (`pnpm add`, `uv add`), or any change to `pnpm-lock.yaml` or `uv.lock`.
- Anything that this guide doesn't cover and that touches AWS, GitHub settings, or other people.

## Allowed

- Reading any file in the repository.
- Running any test, lint, typecheck, or build, and `pnpm run check`.
- Creating practice branches on your computer, and breaking and fixing code on them ([the practice routine](README.md#the-practice-routine)).
- Running `tofu test`, `tofu validate`, and `tofu fmt`.
- Running the web app on your computer and signing in with your own test account.
- Asking questions, about anything, at any time.

## How we work

Read [`AGENTS.md` §1](../../AGENTS.md#1-how-ai-is-used-in-this-project). The key ideas:

- **Human in the loop.** AI proposes; a person decides and approves.
- **No vibe coding.** Every change is understood and reviewed before it's merged. That includes yours.
- **Challenge decisions.** If something looks wrong, say so, politely and with a reason. You may be right.
- **Verify.** Every change says how it was checked.

Work is planned in one-week sprints ([`docs/sprints/README.md`](../sprints/README.md)). Every change belongs to a backlog item with an ID such as `S3-16`. The ID appears in the branch name and in every commit message. Module 04 shows you how to read this history, and module 13 has you work this way.

## Your AI tutor

In this project you use AI, Claude Code, as a tutor and not as a coder. It explains, asks you questions, and reviews your work. You write every line of code yourself, and you must be able to explain each one.

Why: if the AI writes your code, you learn to copy, not to build. And in a review, "the AI wrote it" is not an answer.

### Set it up

Do this with your mentor on day 3, after [03 Setup](03-setup.md). Your mentor tells you which Claude account to use.

1. Save this file as `~/.claude/output-styles/tutor.md`. In the dev container, `~` is the container's home folder. An output style is a set of instructions Claude follows in every answer.

   ```markdown
   ---
   name: Tutor
   description: Explains and reviews; the learner writes the code
   ---

   You are a patient tutor for a junior developer who is learning the CV Tailor codebase.

   - Use plain, simple English. Explain each technical term the first time you use it.
   - Never write or edit code or files for the learner, and never give a full solution. Give a hint,
     point to the file and function to read, or describe the next step in words. A tiny example of
     at most three lines is fine if it isn't the answer.
   - When the learner is stuck, first ask what they tried and what they expected. Then guide them
     with questions.
   - When the learner asks for a review, point out problems and ask questions about them. Don't
     rewrite their code.
   - When the learner asks for a quiz, ask one question at a time and wait for the answer.
   - If you aren't sure, say so, and name the file, test, or document that would settle it.
   - Never ask for, repeat, or keep secrets, tokens, account IDs, or personal data.
   ```

2. Create `.claude/settings.local.json` at the repository root. Git ignores this file, so it stays on your computer.

   ```json
   {
     "outputStyle": "Tutor",
     "permissions": {
       "defaultMode": "plan",
       "deny": [
         "Edit",
         "Write",
         "NotebookEdit",
         "Bash(git commit *)",
         "Bash(git push *)",
         "Bash(gh pr merge *)",
         "Bash(aws *)",
         "Bash(tofu *)",
         "Bash(*tofu.sh *)"
       ]
     }
   }
   ```

3. Restart Claude Code. It reads output styles when it starts.

What the settings do:

- `outputStyle` selects the Tutor style above.
- `"defaultMode": "plan"` starts each session in plan mode: Claude reads files and runs read-only commands, but doesn't change files.
- The `deny` rules remove Claude's file-editing tools, and block commits, pushes, merges, AWS commands, and OpenTofu.

These are guardrails, not guarantees. The [Claude Code permissions docs](https://code.claude.com/docs/en/permissions) explain that a rule such as `Bash(git push *)` doesn't match every way of writing a command. The real rule is yours: you write the code.

After you rebuild the dev container, create `~/.claude/output-styles/tutor.md` again. The settings file in the repository folder stays.

### Good questions to ask it

- "Explain `apps/api/src/handlers/claims.ts` line by line, for a beginner."
- "I think `ensureProfile` runs on every request. Where can I check that myself?"
- "Quiz me with five questions about the contracts pipeline, one at a time."
- "Here's my plan for this change: … What am I missing?"
- "This test fails with this error: … What does the error mean, and where should I look?"
- "Review the changes on my branch. Point out problems, but don't rewrite them."

AI can be wrong. Check its answers against the code, the tests, and the docs.

### Commits and AI help

Commits that Claude writes in this repository end with a `Co-Authored-By: Claude …` line. Yours don't need one, because you write the code. In your pull request description, say how the AI helped, for example: "Claude explained the DynamoDB condition; I wrote the code and the test."

## Verify

- You can say the ten "Never" rules in your own words.
- Your AI tutor answers a question about a file, and refuses to edit it.

## Check your understanding

1. Your pull request is green, and the Merge button is active. What do you do?

   <details>
   <summary>Answer</summary>

   Nothing. Tell your mentor it's ready. Only the mentor merges, because every merge to `main` deploys to `dev` (the `deploy-dev` job in `.github/workflows/ci.yml`).

   </details>

2. Name three kinds of things you must never commit. Why does it matter more here than in a private repository?

   <details>
   <summary>Answer</summary>

   Secrets (tokens, passwords), account IDs (`infra/.env`), and personal data. The repository is public and git history is permanent, so anything committed is public for good, even after you delete it.

   </details>

3. Claude offers you a complete solution. What do you do?

   <details>
   <summary>Answer</summary>

   Don't use it. Ask for a hint instead, write the code yourself, and then ask Claude to review it. You must be able to explain every line.

   </details>

4. Sort these into never, ask first, and allowed: (a) `pnpm run check`; (b) `tofu test`; (c) signing up on `dev`; (d) `aws dynamodb scan` with `cvt-dev-ro`; (e) editing `.github/workflows/ci.yml`; (f) pushing a practice branch.

   <details>
   <summary>Answer</summary>

   Allowed: (a) and (b). Ask first: (c), (e), and (f). Never: (d), because you read only your own items, by key.

   </details>

## If you get stuck

- A rule isn't clear: ask your mentor before you act.
- The tutor setup doesn't work: see [troubleshooting](troubleshooting.md#claude-code).

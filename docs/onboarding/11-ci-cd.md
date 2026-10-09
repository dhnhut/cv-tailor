# 11 CI/CD

**Time:** 3 hours · **Week:** 3 · **Safety:** `[No AWS]`, then `[GitHub write]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Know what runs when you push, what runs when your mentor merges, and how to read a CI run. Open a practice pull request.

## Before you start

- [10 Infrastructure](10-infrastructure.md) done.
- Your mentor has invited you as a collaborator, and `gh auth status` says you're logged in ([03 Setup](03-setup.md#7-sign-in-to-github-from-the-container)).

## Learn first

- [02 Learning path](02-learning-path.md): 14 (GitHub Actions).

## Read

1. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Look for: the two triggers (`pull_request`, and `push` to `main`); the `check` job's steps; and the `deploy-dev` job's `if:`.
2. [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). Look for: `environment: dev`; why the builds run **before** the AWS credentials step (the comments say: install and build run third-party code); and `cancel-in-progress: false`.
3. [`.github/dependabot.yml`](../../.github/dependabot.yml). Look for: the four kinds of dependencies Dependabot updates every week.
4. [Deploy and rollback runbook](../runbooks/deploy-and-rollback.md): §1 Normal deploy, §5 A deploy failed, and §6 Roll back. You'll never run these, but you'll see them happen.

### What happens, and when

```text
You push a branch, or open a pull request
└── ci.yml, job "check" (no AWS access)
    ├── install tools: Node.js, pnpm, uv, OpenTofu, TFLint, Trivy
    ├── pnpm install --frozen-lockfile     the lockfile must already match package.json
    ├── uv sync                            uv.lock must already match pyproject.toml
    ├── pnpm run check                     the same command you run (module 03)
    └── pnpm run contracts:check           generated files must be committed

Your mentor merges to main
└── ci.yml: "check" again, then "deploy-dev" → deploy.yml (GitHub Environment "dev")
    ├── build the web app and the API bundles
    ├── sign in to AWS with OIDC: a short-lived role, no stored keys
    ├── tofu plan, then apply, for the dev workload stack
    └── upload the web app to S3, and clear CloudFront's cache
```

The `main` branch only accepts a pull request whose `check` job is green and whose branch is up to date with `main`. The repository's settings enforce this.

## Do

### K1 Which step fails? `[No AWS]`

For each mistake, predict the first CI step that fails. Write your answers down, then open the answers.

1. A Markdown table you didn't format.
2. A change to a registered contract without `pnpm run generate`.
3. A package added by editing `package.json` by hand, without `pnpm install`.
4. A test file that drops a package's coverage below 80%.
5. A misaligned `=` in a `.tf` file.
6. A new AWS call in `apps/api/src/data/profiles.ts`, without the IAM change.

<details>
<summary>Answers</summary>

1. "Lint (including workflows), typecheck, test, build": `pnpm run check` starts with `prettier --check .`.
2. "Contracts drift check", the last step. Everything else passes, because the TypeScript side reads the Zod source directly.
3. The `pnpm install --frozen-lockfile` step: the lockfile no longer matches `package.json`.
4. `pnpm run check`: the package's `test` script fails the coverage gate.
5. `pnpm run check`: infra's `lint` runs `tofu fmt -check`.
6. None, once you've updated the unit tests to match: they use fakes, and `api.tftest.hcl` pins the IAM policy, not what the code calls. The first real call in `dev` would be refused with `AccessDenied`. That's why a new AWS call needs its IAM change, and the exact-match test's update, in the same pull request (module 06).

</details>

### K2 Read a real run `[No AWS]`

Open the repository's **Actions** tab on GitHub, and open the latest run on `main`. Find:

- the `check` job's steps, and which one took longest;
- the `deploy-dev / deploy` job, the "Apply the dev workload stack" step, and its summary line (`Apply complete!` with counts of added, changed, and destroyed resources);
- the "Show deploy identity" step: the role CI signed in with. Its account ID is masked, because the repository is public.

### K3 A practice pull request `[GitHub write]`

Ask your mentor first.

1. Follow [the practice routine](README.md#the-practice-routine) with a branch named `practice/11-ci`.
2. Add one row to a table in `docs/onboarding/troubleshooting.md`, and leave its columns misaligned.
3. Commit with a message such as `PRACTICE ci check`, then `git push -u origin practice/11-ci`.
4. Open a **draft** pull request titled "PRACTICE: do not merge": `gh pr create --draft --title "PRACTICE: do not merge" --body "Practice for onboarding module 11."`
5. Watch the checks: `gh pr checks --watch`. Expected: `check` fails. Open it, and find the `prettier --check` line that names your file.
6. Run `pnpm run format`, commit, and push. Expected: `check` passes.
7. Close it without merging: `gh pr close --delete-branch`. Then `git switch main` and `git branch -D practice/11-ci`.

### K4 Dependabot `[No AWS]`

Open one Dependabot pull request on GitHub. Explain in your notes:

- why every action in the workflows is pinned to a commit SHA, with the version in a comment;
- why some updates must not be merged even when they look harmless: read "Version constraints" in [`packages/config/README.md`](../../packages/config/README.md#version-constraints).

## Verify

- You can say what runs on a push, and what runs on a merge to `main`.
- Your practice pull request failed on formatting, passed after the fix, and is closed.

## Check your understanding

1. When does `deploy-dev` run?

   <details>
   <summary>Answer</summary>

   Only on a push to `main`, which happens when a pull request is merged, and only after `check` passes (`needs: check` and the `if:` in `ci.yml`).

   </details>

2. Why does the deploy build everything before it gets AWS credentials?

   <details>
   <summary>Answer</summary>

   Installs and builds run third-party code, for example package install scripts. If they ran with AWS credentials, that code could use them.

   </details>

3. Why is the contracts drift check the last step?

   <details>
   <summary>Answer</summary>

   It runs `pnpm run generate`, which rewrites files in the working tree. The other steps must check the files as they were committed.

   </details>

4. Why is a running deploy never cancelled (`cancel-in-progress: false`)?

   <details>
   <summary>Answer</summary>

   An apply holds the OpenTofu state lock, and stopping it halfway can leave resources half-changed and the lock held.

   </details>

5. Does a merge that changes only documentation deploy?

   <details>
   <summary>Answer</summary>

   Yes. Every push to `main` runs `deploy-dev`. If nothing changed, the plan shows no changes and the apply does nothing.

   </details>

## If you get stuck

- `gh` says you aren't logged in: run `gh auth login` again.
- `git push` is refused with "permission denied": your mentor's invitation hasn't been accepted yet. Check your GitHub notifications.

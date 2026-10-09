# 04 Repo Tour

**Time:** 4 hours · **Week:** 1 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `2e9e051`

## Goal

Know where everything is, how the packages fit together, and how to use git history to find out why code looks the way it does.

## Before you start

- [03 Setup](03-setup.md) done: `pnpm run check` passes.

## Learn first

- [02 Learning path](02-learning-path.md): 2 (Git) and 5 (Node.js and pnpm).

## Read

1. [ADR-0001](../adr/0001-monorepo-pnpm-workspaces.md), the Context and Decision sections. Look for: why one repository, and why pnpm's own task ordering instead of a tool such as Turborepo or Nx.
2. [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml). Look for: `packages`, which folders are packages, and `tasks`, what runs before what.
3. The root [`package.json`](../../package.json). Look for: the `scripts`.
4. [`packages/config/README.md`](../../packages/config/README.md). Look for: the strict TypeScript settings, and how the coverage gate works.

## The map

```text
cv-tailor/
├── apps/web/            The React web app that runs in the browser          (module 07)
├── apps/api/            The Lambda functions behind the API                 (module 06)
├── packages/contracts/  The data shapes every part shares, in Zod           (module 05)
├── packages/config/     Shared TypeScript, ESLint, Prettier, and Vitest settings
├── services/agents/     The Python AI agent service                         (module 09)
├── infra/               The infrastructure, in OpenTofu                     (module 10)
├── docs/                ADRs, runbooks, sprint docs, and this guide
├── scripts/             Repository scripts, such as the contracts check
├── .devcontainer/       The development container                           (module 03)
└── .github/             The CI and deploy workflows, and Dependabot         (module 11)
```

### Packages

| Folder               | Package name           | Language                      | Tested with             |
| -------------------- | ---------------------- | ----------------------------- | ----------------------- |
| `apps/web`           | `@cv-tailor/web`       | TypeScript and React          | Vitest, Testing Library |
| `apps/api`           | `@cv-tailor/api`       | TypeScript on Node.js         | Vitest                  |
| `packages/contracts` | `@cv-tailor/contracts` | TypeScript and Zod            | Vitest                  |
| `packages/config`    | `@cv-tailor/config`    | Configuration                 | —                       |
| `services/agents`    | `@cv-tailor/agents`    | Python                        | pytest                  |
| `infra`              | `@cv-tailor/infra`     | OpenTofu (HCL) and TypeScript | `tofu test` and Vitest  |

The Python service and the infrastructure are pnpm packages too. Their `package.json` scripts only call `uv` and `tofu`, so one command checks everything (ADR-0001).

### What `pnpm run check` runs

```text
pnpm run check
├── prettier --check .          Is every file formatted?
├── pnpm run lint:workflows     actionlint checks .github/workflows/, in Docker
└── pnpm -r run check           In every package: lint, typecheck, test, and build
                                (pnpm-workspace.yaml's tasks: a package's dependencies are built first)
```

### Generated files

Never edit these by hand. `pnpm run generate` writes them, as module 05 shows:

- `packages/contracts/schemas/`
- `services/agents/src/cv_tailor_agents/contracts/`
- `infra/generated/`

### Conventions you'll see everywhere

- **IDs in comments.** Comments explain _why_, and cite sprint items (`S2-07`), ADR sections (`ADR-0009 §6`), and requirement IDs (`KB-06`). Search for an ID to find its story.
- **File names.** TypeScript modules use kebab-case (`documents-bucket.ts`), React components use PascalCase (`ProfilePage.tsx`), and Python uses snake_case. Tests mirror the source folders: the tests for `apps/api/src/data/profiles.ts` are in `apps/api/test/data/profiles.test.ts`.
- **Strict TypeScript.** The settings in `packages/config/tsconfig/base.json`, such as `noUncheckedIndexedAccess`, catch mistakes before the code runs.
- **Branches and commits.** A branch is named `s<sprint>/<item>-<slug>`, for example `s3/07-document-api`. Every commit message starts with the item ID, for example `S3-07 document api`.

### The local git routine

Your everyday commands, on your own computer:

```bash
git status                                  # What changed?
git diff                                    # The changes, line by line
git switch main && git pull --ff-only       # Get the latest main (needs a clean working tree)
git switch -c s3/99-my-change               # A new branch; your mentor gives you the item ID
git add <file> && git commit -m "S3-99 Short description"
git log --oneline -5                        # Your last five commits
```

Pushing and pull requests come in modules 11 and 13.

## Do

### T1 Who depends on contracts? `[No AWS]`

Predict: which packages use `@cv-tailor/contracts`? Look at each package's `package.json`, in `dependencies` and `devDependencies`, and write down your answer. Then run:

```bash
pnpm --filter "...@cv-tailor/contracts" ls --depth -1
```

`...@cv-tailor/contracts` means "this package, and every package that depends on it".

Expected: five packages: `@cv-tailor/contracts` itself, `@cv-tailor/api`, `@cv-tailor/web`, `@cv-tailor/infra`, and `@cv-tailor/agents`. Why would the infrastructure and the Python service need a TypeScript package? Keep your guess for module 05.

### T2 Find out why a line exists `[No AWS]`

`apps/api/src/data/profiles.ts` saves a profile with the condition `attribute_not_exists`. Find the commit that added it:

```bash
git log --oneline -S 'attribute_not_exists' -- apps/api/src/data/profiles.ts
```

`-S` finds the commits that added or removed that text.

Expected: `3e7ce84 S2-08 implement GET /me api`.

Then see everything that commit changed with `git show --stat 3e7ce84`, and read items S2-08 and S2-09 in the [Sprint 2 doc](../sprints/sprint-02-walking-skeleton.md#backlog) to see what the work was for.

### T3 Follow a sprint item through the code `[No AWS]`

```bash
git grep -n "S2-07" apps/api/src
```

Expected: lines in `data/keys.ts`, `handlers/log.ts`, `handlers/me/handler.ts`, and the `triggers/pre-sign-up/` files. Some of them say "S2-07 lesson". Find that lesson in the [Sprint 2 review](../sprints/sprint-02-walking-skeleton.md#sprint-review): it starts with "Lambda logs every error a handler throws". In your notes, explain why `log.ts` logs only an error's name.

### T4 Build the API `[No AWS]`

```bash
pnpm --filter @cv-tailor/api build
ls apps/api/dist
```

Expected: esbuild lists five bundles, `create-document`, `delete-document`, `list-documents`, `me`, and `pre-sign-up`, each 1 to 2 MB. The ⚠️ next to each size means only that the file is large; it isn't an error. Each folder becomes one Lambda function. Compare the list with the `build` script in `apps/api/package.json`.

### T5 Read one sprint item's commits `[No AWS]`

```bash
git log --oneline --grep 'S3-07'
```

Expected: two commits, `S3-07 document api` and `S3-07 verification documents`. Open the first with `git show --stat <hash>`, and match the files it changed with the S3-07 row in the [Sprint 3 doc](../sprints/sprint-03-knowledge-base-and-first-agent.md#backlog).

## Verify

From memory, you can draw the folder map, and say what `pnpm run check` runs, in order.

## Check your understanding

1. Which packages depend on `@cv-tailor/contracts`, and how?

   <details>
   <summary>Answer</summary>

   `@cv-tailor/web` and `@cv-tailor/api` import it at run time (`dependencies`). `@cv-tailor/infra` and `@cv-tailor/agents` list it in `devDependencies`: the infra scripts check `config.json` with its `WebConfig` schema, and both have files generated from the contracts, so pnpm runs the contracts' `generate` first.

   </details>

2. How does pnpm run the Python and OpenTofu tasks?

   <details>
   <summary>Answer</summary>

   `services/agents/package.json` and `infra/package.json` define scripts such as `lint` and `test` that call `uv run …` and `tofu …`. pnpm runs them like any other package's scripts.

   </details>

3. What does `dependsOn: ['^build']` mean in `pnpm-workspace.yaml`?

   <details>
   <summary>Answer</summary>

   Before this task runs in a package, build the packages it depends on.

   </details>

4. Which folders hold generated files, and what do you do instead of editing them?

   <details>
   <summary>Answer</summary>

   `packages/contracts/schemas/`, `services/agents/src/cv_tailor_agents/contracts/`, and `infra/generated/`. Change the Zod source in `packages/contracts/src/`, then run `pnpm run generate`.

   </details>

5. A comment ends with `(S2-07 lesson)`. How do you find the lesson?

   <details>
   <summary>Answer</summary>

   Open the Sprint 2 doc and search its Sprint Review for `S2-07`.

   </details>

## If you get stuck

- `git log` or `git show` fills the screen and waits: press `q` to quit, and the arrow keys to scroll.
- See [troubleshooting](troubleshooting.md).

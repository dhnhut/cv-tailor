# ADR-0001: Monorepo with pnpm Workspaces

| Field       | Value                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status      | Accepted                                                                                                                                                   |
| Date        | 2026-09-27                                                                                                                                                 |
| Deciders    | Project owner                                                                                                                                              |
| Sprint item | S0-02                                                                                                                                                      |
| Amended     | 2026-10-07: `infra` is OpenTofu, run through a `package.json` wrapper like the Python service (S3-15, [ADR-0013](0013-infrastructure-as-code-opentofu.md)) |

## Context

CV Tailor has four deployable or buildable parts, in two languages:

| Part                              | Language    | Tooling                |
| --------------------------------- | ----------- | ---------------------- |
| Web SPA (`apps/web`)              | TypeScript  | pnpm, Vite, Vitest     |
| API Lambdas (`apps/api`)          | TypeScript  | pnpm, Vitest           |
| Agent service (`services/agents`) | Python 3.12 | uv, pytest, ruff, mypy |
| Infrastructure (`infra`)          | HCL         | pnpm wrapper, OpenTofu |

These parts are tightly coupled:

- The API and the agents exchange payloads. Both sides must agree on the same shape, or calls fail at runtime.
- The OpenTofu workload stack deploys the API, the web app, and the agents together, per environment ([ADR-0013](0013-infrastructure-as-code-opentofu.md)).
- A single feature (for example GEN-04, async generation) usually changes the API, the agents, the contracts, and the infrastructure at the same time.

The project has one developer, a low user volume, and a goal of long-term maintainability. The repository is also a public portfolio, so a reviewer should be able to understand the whole system from one place.

We need to decide how to organise the code into repositories, and how to run tasks (lint, typecheck, test, build) across all parts.

### Decision drivers

1. **Contract safety.** The TypeScript API and the Python agents must not drift apart.
2. **Atomic changes.** One feature should be one PR, reviewed and tested as a whole.
3. **Low overhead for one developer.** Fewer repos, pipelines, and release steps to maintain.
4. **Fewest tools to maintain.** Every tool must be understood well enough for the long term, so each new tool must earn its place. Need to balance between benefit and effort.
5. **Simple CI.** One pipeline that checks every part.
6. **Polyglot support.** The tooling must handle both TypeScript and Python.

### Relevant facts about pnpm

The project already uses pnpm 12 (pinned through Corepack). pnpm 12 covers most of what a separate monorepo task runner would add:

| Capability              | How pnpm provides it                                                                                                  | Source                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Workspace packages      | `pnpm-workspace.yaml` lists the package folders.                                                                      | [Workspaces](https://pnpm.io/workspaces)                           |
| Dependency-ordered runs | `pnpm -r run <script>` follows the workspace dependency graph by default, with a default concurrency of 4.            | [pnpm -r](https://pnpm.io/cli/recursive)                           |
| Task dependencies       | A `tasks` block in `pnpm-workspace.yaml` declares `dependsOn`, for example `^build` (build dependencies first).       | [Task orchestration](https://pnpm.io/workspace-task-orchestration) |
| Changed packages only   | `pnpm --filter "...[origin/main]" <script>` selects changed packages and their dependents.                            | [Filtering](https://pnpm.io/filtering)                             |
| Task caching            | Only through `pnpm pipeline` (added in v12.4.0, marked **experimental**). A plain `pnpm -r run` never uses the cache. | [pnpm pipeline](https://pnpm.io/cli/pipeline)                      |

The contracts pipeline also does not need build ordering. The API reads the Zod source directly, and the generated Pydantic files are committed into the agent service, so no package waits for a contracts build step. Only the generator and the CI drift check need an order ([ADR-0003](0003-contracts-codegen.md)).

## Options Considered

### Option A: Multi-repo (one repository per part)

Separate repositories for web, API, agents, infra, and a shared contracts package.

- **Pros**
  - Each repo is small and has a focused CI pipeline.
  - Independent release cycles and access control per repo.
  - Clear ownership boundaries, which matters for larger teams.
- **Cons**
  - Shared contracts must be published and versioned (to npm and PyPI, or through git submodules). Each consumer can pin a different version, which brings back the drift problem.
  - A cross-cutting feature becomes several coordinated PRs, merged in the right order.
  - Five CI pipelines, five sets of dependency updates, and five sets of branch protection rules to maintain.
  - A reviewer has to jump between repos to understand one feature.

The main benefits of multi-repo (team autonomy and access control) do not apply to a one-person project.

### Option B: Monorepo with pnpm workspaces (chosen)

One repository. pnpm workspaces manage the packages, and pnpm's built-in task orchestration runs tasks across them.

- **Pros**
  - No extra tool. pnpm is already required.
  - Task ordering and `dependsOn` are declared in `pnpm-workspace.yaml`, next to the package list.
  - `--filter` can limit a run to changed packages.
  - Easy to extend later: a task runner such as Turborepo runs the same `package.json` scripts, so it can be added without changing the layout.
- **Cons**
  - No stable task caching. Every CI run checks every package.
  - The `tasks` feature and `pnpm pipeline` are recent pnpm 12 features. They have less community experience behind them than Turborepo or Nx.

### Option C: Monorepo with pnpm workspaces and Turborepo

Option B, plus Turborepo as the task runner.

- **Pros**
  - Mature, stable content-based caching, locally and in CI.
  - Widely used, with many examples and guides.
- **Cons**
  - One more tool and config file (`turbo.json`) to learn and maintain.
  - Turborepo only sees packages that have a `package.json`, and its Python task caching is only correct if the inputs are listed by hand.
  - Its main extra over Option B is caching, and at this repo size a full run is expected to be short.

### Option D: Monorepo with Nx

One repository. Nx runs tasks, with plugins for each technology.

- **Pros**
  - Richer feature set: project graph, code generators, module boundary rules.
  - Community plugins for Python projects.
- **Cons**
  - More concepts and configuration (project files, executors, plugins) than this project needs.
  - Python support depends on community plugins, which adds a maintenance risk.
  - The largest learning curve of the options.

### Option E: Monorepo with a root command runner (`just`, `mise` tasks, or `make`)

pnpm workspaces for TypeScript, plus a language-neutral command runner at the root that calls pnpm and uv.

- **Pros**
  - Language-neutral, so Python needs no `package.json` wrapper.
- **Cons**
  - One more tool and syntax to learn.
  - Root `package.json` scripts already give one entry point, so the gain is small.

Heavier polyglot build systems (for example Bazel, Pants, or moonrepo) were not evaluated in depth. Their setup and learning cost is far beyond the needs of a project at this scale.

## Decision

Use **a single monorepo** with **pnpm workspaces** and pnpm's built-in task orchestration (Option B). No separate task runner is added.

Details:

- **Layout.** `apps/` holds the TypeScript deployables, `packages/` holds shared code, `services/` holds the Python agent service, and `infra/` holds the OpenTofu stacks and modules. The full tree is in the [Sprint 0 plan](../sprints/sprint-00-foundation.md#target-repository-structure).
- **Workspace config.** `pnpm-workspace.yaml` lists the packages (`apps/*`, `packages/*`, `services/*`, `infra`) and declares task dependencies in a `tasks` block.
- **Python integration.** `services/agents` has a thin `package.json` whose scripts call `uv run`, so pnpm runs Python tasks together with the TypeScript tasks. uv remains the only owner of Python dependencies.
- **Contracts.** `packages/contracts` is the single source of truth for payloads. Generated files are committed, and CI fails if they are out of date. The source format and codegen tools are decided in [ADR-0003](0003-contracts-codegen.md): Zod schemas, with JSON Schema and Pydantic generated from them.
- **One entry point.** A root script, `pnpm run check`, runs lint, typecheck, test, and build across every package in both languages, locally and in CI.

Option B is chosen over:

- **A**, because atomic changes and a single contracts source matter more here than team autonomy, which does not apply to one developer.
- **C**, because its main benefit (caching) is not needed at this repo size, and adding it later does not require a layout change.
- **D**, because it adds the most concepts for features this project does not need.
- **E**, because root `package.json` scripts already provide one entry point without a new tool.

## Consequences

### Positive

- One package manager handles packages and task running, which reduces the number of tools to learn.
- A feature that spans the API, agents, contracts, and infra is one branch and one PR.
- Contract changes are checked on both sides in the same CI run, so drift is caught before merge.
- One CI workflow, one set of branch protection rules, and one place for dependency updates.

### Negative

- No task caching. Every CI run checks every package, so CI time grows with the codebase.
- The Python wrapper is a custom convention and must be documented.
- The repo holds two toolchains (Node/pnpm and Python/uv). The devcontainer and CI must set up both.
- All parts share one version history. Independent versioning per part would need extra tooling later, if it is ever needed.

### Risks and mitigations

| Risk                                                 | Mitigation                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| pnpm has trouble running the Python wrapper.         | CI runs the Python steps directly with uv. The wrapper can be removed without changing the rest of the layout.     |
| The pnpm 12 task features change in a later release. | pnpm is pinned through `packageManager` in the root `package.json`, so upgrades are deliberate and tested in a PR. |

### When to revisit this decision

- CI time becomes a real problem. Then add caching, either with `pnpm pipeline` (once it is no longer experimental) or with Turborepo (Option C).
- A second team or external contributor needs separate access control or release cycles.
- Python work becomes most of the codebase, and the wrapper approach no longer fits.

## Verification

This decision is proven in Sprint 0 when:

1. `pnpm install` succeeds at the repo root (S0-03).
2. `pnpm run check` passes for all packages, including `services/agents` (S0-04).
3. `pnpm --filter "...[origin/main]" test` selects only the changed packages and their dependents.
4. Changing the contracts schema without regenerating fails CI (S0-04b).

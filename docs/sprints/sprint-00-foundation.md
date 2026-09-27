# Sprint 0: Foundation

**Sprint goal:** A monorepo skeleton where every part builds, lints, and tests in CI, plus an evidence-based AWS region decision for every required service.

**Dates (tentative):** 2026-09-28 to 2026-10-04 (1 week)

**Status:** Planned

## Scope

- Repository structure (monorepo with pnpm workspaces)
- Package skeletons and a shared contracts pipeline
- CI with GitHub Actions
- Cloud service availability check. Regions in priority order: **Auckland → Sydney → `us-east-1`**

No AWS deployment in this sprint.

---

## Target Repository Structure

```text
.
├── apps/
│   ├── web/                 # React SPA (Vite, Tailwind)
│   └── api/                 # Lambda handlers (TypeScript, Node 22)
├── services/
│   └── agents/              # Python agent service (uv project)
│       ├── src/cv_tailor_agents/   # skeleton only; agent modules come with the agent design sprint
│       ├── evals/           # golden set + eval runners (README placeholder in Sprint 0)
│       ├── tests/
│       ├── pyproject.toml   # ruff, mypy, pytest config
│       └── package.json     # thin wrapper so pnpm can run Python tasks (`uv run ...`)
├── packages/
│   ├── contracts/           # JSON Schema (source of truth) → Zod (TS) + Pydantic (Py)
│   └── config/              # shared eslint, tsconfig, prettier
├── infra/                   # CDK app: stacks per domain, stages per environment
├── docs/
│   ├── adr/                 # architecture decision records
│   ├── sprints/             # sprint plans and reviews
│   ├── cloud/               # service availability report (re-run per account)
│   └── runbooks/            # operations (placeholder until first deploy)
├── scripts/                 # repo scripts (aws-service-check.sh)
├── .github/workflows/
├── package.json             # root workspace (packageManager: pnpm@12.5.1), `check` script
├── pnpm-workspace.yaml      # package list + `tasks` (task dependencies)
└── README.md
```

**Why this structure:**

- **`apps/` + `packages/`** follows the common monorepo convention: `apps/` holds TypeScript deployables and `packages/` holds shared code. `services/` holds the Python service.
- **`packages/contracts`** is the single source of truth for payloads between the TypeScript API and the Python agents, so the two sides can't drift apart. The generated Zod and Pydantic files are committed, and CI checks they are up to date (regenerate, then `git diff --exit-code`).
- **The Python `package.json` wrapper** lets one command (`pnpm run check`) run TypeScript and Python tasks together. uv still owns Python dependencies. See [ADR-0001](../adr/0001-monorepo-pnpm-workspaces.md).
- **Deferred:** `packages/ui` (only needed with a second React app) and the agent modules (these come with the agent design sprint).

---

## Backlog

| ID | Item | Acceptance criteria |
| --- | --- | --- |
| S0-01 | Sprint docs framework | `docs/sprints/README.md` and this sprint doc are merged. |
| S0-02 | ADR-0001: Repository structure | `docs/adr/0001-monorepo-pnpm-workspaces.md` records the context, options (multi-repo, monorepo, and task runner choice), decision, and consequences. `AGENTS.md` is updated. |
| S0-03 | Root workspace + shared config | These files exist: root `package.json` (with `packageManager: pnpm@12.5.1` and `engines.node` set to 22), `pnpm-workspace.yaml` (with a `tasks` block for task dependencies), a root `check` script that runs `lint`, `typecheck`, `test`, and `build` across all packages, and `.editorconfig`. `packages/config` provides the shared ESLint, tsconfig, and Prettier config. `pnpm install` succeeds. |
| S0-04 | Package skeletons | Each of `apps/web`, `apps/api`, `services/agents`, and `infra` has a minimal "hello" and **one passing test**: Vitest for TypeScript, pytest for Python. `infra` passes `cdk synth` (no AWS credentials needed). |
| S0-04b | Contracts pipeline | `packages/contracts` has one placeholder JSON Schema (`HealthResponse`). Codegen produces Zod for `apps/api` and Pydantic for `services/agents`, and each side has a test that uses the generated type. CI fails if the generated files are out of date. |
| S0-05 | CI pipeline | `.github/workflows/ci.yml` runs on every PR and on pushes to `main`. It sets up Node 22 (pnpm via Corepack), Python 3.12, and uv; runs `pnpm install --frozen-lockfile`; runs `pnpm run check`; runs the contracts drift check; and runs `cdk synth`. The workflow passes. |
| S0-06 | Branch protection | `main` requires a PR and a passing CI check. |
| S0-07 | Cloud service availability check | A read-only script (`scripts/aws-service-check.sh`) and a report (`docs/cloud/service-availability.md`). The report has a matrix of each required service against **Auckland, Sydney, and `us-east-1`**, with the evidence source and the date checked. |
| S0-08 | ADR-0002: AWS region | `docs/adr/0002-aws-region.md` picks the **first region, in the order Auckland → Sydney → `us-east-1`, that has every required service**. If no single region fits, it decides on a split, with user data in the highest-priority region and only the missing services in the next one. It records the latency and data-residency trade-off. `AGENTS.md` is updated. |

### S0-07 details: cloud check coverage

**Services to check** (from `AGENTS.md` §5.4 and §7):

- **AgentCore:** Runtime, Memory, Gateway, Observability, Browser, Evaluations, Policy
- **Bedrock:** Guardrails, Knowledge Bases, candidate foundation models, and cross-region inference profiles
- **Vector store options:** record region and pricing notes only. The choice is made in a later sprint.
- **Core services:** Cognito, API Gateway (REST, HTTP, WebSocket), Lambda Node.js 22 runtime, DynamoDB, S3, SQS, Step Functions, Budgets, SSM Parameter Store, Secrets Manager
- **CloudFront** is global, so it is noted only.

**Evidence sources** (every result links to its source):

1. The AWS regional services list and each service's docs page on supported regions.
2. The read-only CLI probe `aws ssm get-parameters-by-path --path /aws/service/global-infrastructure/regions/<region>/services`. This list may lag behind new services, so it is a cross-check only.
3. Read-only list calls per service and region, for example `aws bedrock list-foundation-models --region <region>`. Exact AgentCore CLI command names are confirmed from AWS docs when the script is written.

**Also record:**

- Whether personal data (PII) can stay in NZ or Australia. This is a data-residency input to the decision.
- Auckland is a newer region. Check each service individually; don't assume it's available.
- **Caveat:** model access and service quotas are per account. Results from the current account must be re-checked in the dev/stag/prod accounts once they exist.

---

## Execution Guide (step by step)

See the owner legend in [README.md](README.md#owner-legend). Every step follows the [git flow](README.md#git-flow).

| # | Step | Item | Owner | How | Verify |
| --- | --- | --- | --- | --- | --- |
| 1 | Save the sprint docs | S0-01 | Claude | Write `docs/sprints/README.md` and this file. | I read and approve them. |
| 2 | Enable the Auckland region | S0-07 | **Me** | Newer AWS regions are opt-in. Go to AWS Console → Account → AWS Regions → enable Auckland. Confirm the region code (expected: `ap-southeast-6`). | `aws ec2 describe-regions --all-regions --query "Regions[?RegionName=='ap-southeast-6'].OptInStatus" --profile <p>` shows `opted-in`. |
| 3 | Pick the AWS profile for the check | S0-07 | **Me** | Choose the local AWS profile to use and tell Claude. | `aws sts get-caller-identity --profile <p>` shows the expected account. |
| 4 | Research service availability | S0-07 | Claude | Collect doc evidence for every service × {Auckland, Sydney, us-east-1}. Confirm the AgentCore CLI command names. Draft `docs/cloud/service-availability.md` and `scripts/aws-service-check.sh` (read-only calls only). | I review the sources linked in the report. |
| 5 | Run the check script | S0-07 | **Me** | `bash scripts/aws-service-check.sh --profile <p>` | The output matches the report matrix. Any mismatch is noted in the report. |
| 6 | Decide the region | S0-08 | Claude drafts, **Me** decides | Claude drafts `docs/adr/0002-aws-region.md` using the priority rule. I accept or change it. | ADR status is "Accepted". |
| 7 | Record the repo structure decision | S0-02 | Claude drafts, **Me** decides | Claude drafts `docs/adr/0001-monorepo-pnpm-workspaces.md`. | ADR status is "Accepted". |
| 8 | Root workspace | S0-03 | Me + Claude | `pnpm init`. Set `"private": true`, `packageManager`, and `engines`. Write `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `services/*`, `infra`) with a `tasks` block. Add the root `check` script and `.editorconfig`. Confirm with `--dry-run --json` whether `dependsOn` pulls in extra tasks or only orders the selected ones, and shape `check` to match. | `pnpm install` works, and `pnpm -r run test --dry-run` prints the expected task graph. |
| 9 | Shared config package | S0-03 | Me + Claude | Create `packages/config` with base tsconfig, ESLint flat config, and Prettier config. | A later package extends them without errors. |
| 10 | Web skeleton | S0-04 | Me + Claude | `pnpm create vite apps/web --template react-ts`, add Tailwind and Vitest, and write one component test. | `pnpm --filter web test` and `pnpm --filter web build` pass. |
| 11 | API skeleton | S0-04 | Me + Claude | `apps/api` with a `health` Lambda handler (TS) and one Vitest test. | `pnpm --filter api test` passes. |
| 12 | Agents skeleton | S0-04 | Me + Claude | `uv init --package --name cv-tailor-agents services/agents`. Then `uv add --dev ruff mypy pytest`, add a `package.json` wrapper, and write one pytest test. | `cd services/agents && uv run pytest && uv run ruff check && uv run mypy src` all pass. |
| 13 | Infra skeleton | S0-04 | Me + Claude | In `infra/`: `pnpm dlx aws-cdk init app --language typescript --generate-only`. Convert it to pnpm, and swap Jest for Vitest so all TS packages use one test runner. | `pnpm --filter infra exec cdk synth` prints a template. |
| 14 | Pick the codegen tools | S0-04b | Claude researches, **Me** decides | Compare JSON Schema → Zod and JSON Schema → Pydantic tools on maintenance, schema support, and output quality. | One tool is chosen for each language. |
| 15 | Contracts pipeline | S0-04b | Me + Claude | Add one `HealthResponse` schema, a `generate` script, and the generated files committed in both packages. | Both sides' tests use the generated type, and the drift check fails when the schema changes. |
| 16 | Whole-repo run | S0-03–04b | **Me** | `pnpm run check`, then `pnpm --filter "...[origin/main]" test` after changing one package. | `check` passes, and the filtered run selects only the changed package and its dependents. |
| 17 | CI workflow | S0-05 | Me + Claude | `.github/workflows/ci.yml`: checkout, set up Node 22 and Corepack, set up uv and Python 3.12, `pnpm install --frozen-lockfile`, `pnpm run check`, contracts drift check, `cdk synth`. | The PR shows a green check. |
| 18 | Branch protection | S0-06 | **Me** | GitHub → Settings → Rules → new ruleset for `main`: require a PR and the CI check. (Check whether the repo's visibility and plan allow this.) | A PR with a deliberately failing test can't be merged. |
| 19 | Rebuild the devcontainer | all | **Me** | VS Code → "Rebuild Container". | `postCreate.sh` runs `pnpm install` and `uv sync` with no errors. |
| 20 | Close the sprint | DoD | Claude drafts, **Me** approves | Update `AGENTS.md` with the structure and region decisions, and fill in the sprint review. | The sprint review below is complete. |

Steps 2–6 (cloud) and 7–17 (repo) are independent, so they can run in parallel.

---

## Out of Scope (moved to Sprint 1)

- Creating the AWS Organization and the dev/stag/prod accounts
- CDK bootstrap and any deploy
- Any feature code (auth, knowledge base, agents)
- Coverage gates (the 80% target is enforced once real code exists)

## Risks

| Risk | Mitigation |
| --- | --- |
| AgentCore or Bedrock features are missing in Auckland, and possibly in Sydney. | S0-08 applies the priority rule and uses a split-region setup where needed. |
| pnpm has trouble with the Python wrapper. | CI runs the Python steps directly with uv. |
| JSON Schema codegen doesn't support every schema feature. | Keep schemas to a simple subset, and prove the pipeline with one schema first. |
| The sprint runs over 1 week (9 items). | S0-04b is the first item to move to Sprint 1. |

## Definition of Done (Sprint 0)

- All S0 items are merged to `main` through PRs with green CI.
- ADR-0001 and ADR-0002 are accepted.
- `AGENTS.md` records the repository structure and region decisions.
- The sprint review is filled in.

## Verification

1. Rebuild the devcontainer. `postCreate.sh` runs `pnpm install` and `uv sync` without errors.
2. `pnpm run check` passes, and `pnpm --filter "...[origin/main]" test` selects only changed packages and their dependents.
3. `pnpm --filter infra exec cdk synth` produces a template.
4. Change a field in the contracts schema without regenerating. CI fails the drift check. Regenerate, and the TS and Python tests both pick up the change.
5. Open a PR. CI is green. A deliberately failing test turns CI red and blocks the merge.
6. `scripts/aws-service-check.sh --profile <p>` gives output that matches `docs/cloud/service-availability.md`.

---

## Sprint Review

_To be filled in at the end of the sprint._

- **Done:**
- **Not done / carried over:**
- **What changed and why:**
- **Lessons learned:**
- **Sprint 1 backlog:**

# 05 Contracts

**Time:** 5 hours · **Week:** 2 · **Safety:** `[No AWS]` · **Last checked:** 2026-10-09, `81f6f15`

## Goal

Understand how one data shape, written once in Zod, is shared by TypeScript and Python, and what breaks when it changes.

## Before you start

- [04 Repo tour](04-repo-tour.md) done.

## Learn first

- [02 Learning path](02-learning-path.md): 7 (Zod).

## Read

1. [ADR-0003](../adr/0003-contracts-codegen.md), Context and Decision. Look for: why Zod is the source, and why the generated files are committed.
2. [`packages/contracts/README.md`](../../packages/contracts/README.md), all of it. Look for: the diagram, and the Conventions table.
3. [`packages/contracts/src/health.ts`](../../packages/contracts/src/health.ts), then the two files generated from it, side by side:
   - [`packages/contracts/schemas/health_response.json`](../../packages/contracts/schemas/health_response.json)
   - [`services/agents/src/cv_tailor_agents/contracts/health_response.py`](../../services/agents/src/cv_tailor_agents/contracts/health_response.py)

   Look for: where `.describe()` text ends up, and how `strictObject` becomes `"additionalProperties": false` and then `extra="forbid"`.

4. [`packages/contracts/src/me.ts`](../../packages/contracts/src/me.ts) and [`documents.ts`](../../packages/contracts/src/documents.ts). Look for: why they aren't registered (the comment says who reads them).
5. [`packages/contracts/scripts/generate.ts`](../../packages/contracts/scripts/generate.ts) and [`scripts/check-contracts.sh`](../../scripts/check-contracts.sh). Look for: what is generated, and what the check compares.

### The pipeline

```text
packages/contracts/src/*.ts            Zod: the only files you edit
   │  pnpm run generate (contracts: z.toJSONSchema)
   ├─▶ packages/contracts/schemas/*.json                      JSON Schema, for registered contracts
   │      │  (agents: datamodel-codegen)
   │      └─▶ services/agents/src/cv_tailor_agents/contracts/  Pydantic classes for Python
   └─▶ infra/generated/contracts.json                          constants OpenTofu reads
```

TypeScript packages import the Zod source directly. Python uses the generated classes. `pnpm run contracts:check` regenerates everything and fails if the result differs from what is staged or committed.

## Do

Use [the practice routine](README.md#the-practice-routine) for C2 to C4, on a branch such as `practice/05-contracts`.

### C1 Run the tests `[No AWS]`

```bash
pnpm --filter @cv-tailor/contracts test
```

Expected: every test passes, and the coverage summary is at 80% or more. Open `packages/contracts/test/health.test.ts`: one valid case, and one invalid case for each rule.

### C2 Change a contract, and follow the damage `[No AWS]`

In `packages/contracts/src/health.ts`, add a required field after `status`:

```ts
version: z.string().min(1).describe('The running version.'),
```

1. Run `pnpm run generate`, then `git diff --stat`.
   Expected: three files changed: your `health.ts`, `schemas/health_response.json`, and `health_response.py`.
2. Run `pnpm run contracts:check`.
   Expected: `❌ Generated contracts are out of date…`. The generated files differ from what is staged.
3. Stage them, and check again:

   ```bash
   git add packages/contracts/schemas services/agents/src/cv_tailor_agents/contracts
   pnpm run contracts:check
   ```

   Expected: `✅ Generated contracts are up to date.` The check compares with the staging area, the files you're about to commit.

4. **Predict** which of these fail, then run them:

   ```bash
   pnpm --filter @cv-tailor/contracts exec vitest run
   pnpm --filter @cv-tailor/api typecheck
   (cd services/agents && uv run mypy)
   (cd services/agents && uv run pytest tests/test_health.py tests/test_contracts.py)
   ```

   Expected:
   - the contracts tests: 4 failures in `test/health.test.ts`, because `{ status: 'ok' }` is no longer valid;
   - the API typecheck: `error TS2741: Property 'version' is missing` in `src/handlers/health.ts`;
   - mypy: `Missing named argument "version" for "HealthResponse"` in `src/cv_tailor_agents/health.py`;
   - pytest: 3 failures, in `test_health.py` and `test_contracts.py`.

   One change, caught in both languages, before anything is deployed. That's the point of a contract.

### C3 Make it optional `[No AWS]`

Add `.optional()` after `.min(1)`, and run `pnpm run generate` again.

Expected: the Python field becomes `version: Annotated[str | None, …] = None`. The API typecheck passes now. Two pytest tests still fail: open them and explain why.

### C4 What JSON Schema can't express `[No AWS]`

Replace your field with `checkedAt: z.date()` and run `pnpm run generate`.

Expected: it stops with `Error: Date cannot be represented in JSON Schema`. Generation runs with `unrepresentable: 'throw'`, so a type Python can't receive fails loudly instead of being dropped. How would you send a date instead? (Hint: look for `toISOString()` in `apps/api/src/data/profiles.ts`.)

Reset when you're done.

## Verify

You can draw the pipeline from memory, and say which files you edit and which you never edit.

## Check your understanding

1. Why `z.strictObject` and never `z.object`?

   <details>
   <summary>Answer</summary>

   `z.object` silently drops unknown keys, while the Pydantic model (`extra="forbid"`) rejects them. `strictObject` makes both sides reject unknown keys, so they agree.

   </details>

2. Why isn't `MeResponse` registered?

   <details>
   <summary>Answer</summary>

   Only TypeScript reads it (the API and the web app), so no Python class is needed. Its test checks that it stays unregistered.

   </details>

3. What does `pnpm run contracts:check` compare?

   <details>
   <summary>Answer</summary>

   It regenerates every file, then compares the result with the staging area, and also looks for new untracked files. Any difference fails it.

   </details>

4. Why is `infra` a dependent of `@cv-tailor/contracts` (module 04, T1)?

   <details>
   <summary>Answer</summary>

   Its scripts check `config.json` with `WebConfig`, and `infra/generated/contracts.json` is generated from a contracts constant (`DOCUMENTS_KEY_PREFIX`), which OpenTofu reads.

   </details>

## If you get stuck

- `pnpm run generate` fails in the agents step: run `(cd services/agents && uv sync)` first.
- A generated file looks wrong: never edit it. Fix the Zod source and generate again.

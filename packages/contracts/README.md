# @cv-tailor/contracts

The single source of truth for payloads shared between the TypeScript API (`apps/api`) and the Python agent service (`services/agents`).

Contracts are written once, as [Zod](https://zod.dev) schemas. Everything else is generated from them.

```text
src/*.ts (Zod)                                        ← edit only these
   │  pnpm run generate   (1) z.toJSONSchema
   ▼
schemas/*.json (JSON Schema, draft 2020-12)           ← generated, committed
   │                      (2) datamodel-code-generator
   ▼
services/agents/src/cv_tailor_agents/contracts/*.py   ← generated Pydantic v2, committed
```

| Consumer          | Uses                                                                             | Checked at                                 |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/api` (TS)   | The Zod schema directly: `import { HealthResponse } from '@cv-tailor/contracts'` | Compile time (type) and runtime (`.parse`) |
| `services/agents` | The generated Pydantic model                                                     | Runtime (`model_validate`) and mypy        |

The reasons for this design, and the tools that were compared, are recorded in [ADR-0003](../../docs/adr/0003-contracts-codegen.md).

## Commands

Run these from the repo root.

| Task                                | Command                                       |
| ----------------------------------- | --------------------------------------------- |
| Regenerate JSON Schema and Pydantic | `pnpm run generate`                           |
| Check generated files are committed | `pnpm run contracts:check`                    |
| Test this package                   | `pnpm --filter @cv-tailor/contracts test`     |
| Regenerate JSON Schema only         | `pnpm --filter @cv-tailor/contracts generate` |

`pnpm run generate` runs this package first, then `services/agents`. The order comes from the `generate` task in `pnpm-workspace.yaml` and from the agents package's dev dependency on this one.

`pnpm run contracts:check` (in `scripts/check-contracts.sh`) regenerates everything and fails if the result differs from what is committed. CI runs it, so a schema change without regenerated files cannot be merged.

## Adding a contract

1. Create `src/<name>.ts`:

   ```ts
   import * as z from 'zod';
   import { contracts } from './registry.ts';

   export const JobDescription = z
     .strictObject({
       title: z.string().min(1).describe('Job title as written in the post.'),
       url: z.url().optional(),
     })
     .describe('A job description submitted by a candidate.');
   JobDescription.register(contracts, { id: 'JobDescription' });
   export type JobDescription = z.infer<typeof JobDescription>;
   ```

2. Export it from `src/index.ts`: `export { JobDescription } from './job-description.ts';`
3. Add tests in `test/`: one valid case, plus one invalid case for each rule.
4. Run `pnpm run generate`. This writes `schemas/job_description.json` and `services/agents/src/cv_tailor_agents/contracts/job_description.py`.
5. Add the same valid and invalid cases to `services/agents/tests/test_contracts.py`, so both languages are proven to agree.
6. Commit the Zod source **and** the generated files together.

To use one contract inside another, reference the schema as usual (`job: JobDescription`). Generation writes a `$ref` to `job_description.json`, and Python imports the shared class instead of duplicating it.

## Conventions

| Rule                                                 | Why                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The schema `const` and its type share one name.      | TypeScript keeps values and types in separate namespaces, so one import gives both. The name also matches the Python class.                                                                                      |
| The `id` is PascalCase and equal to the export name. | The `id` becomes the JSON Schema `title`, which becomes the Python class name. The file name is the `id` in snake_case, which becomes the Python module name.                                                    |
| Use `z.strictObject`, never `z.object`.              | `z.object` silently strips unknown keys, but the generated Pydantic model (`extra="forbid"`) rejects them. `strictObject` makes both sides reject.                                                               |
| Add `.describe()` to contracts and to fields.        | Descriptions become JSON Schema `description`, then Python docstrings and `Field(description=...)`.                                                                                                              |
| Only use Zod features that JSON Schema can express.  | Not allowed: `.transform()`, `.refine()` / `.superRefine()`, `z.date()`, `z.bigint()`, `z.custom()`. Generation runs with `unrepresentable: 'throw'`, so it fails instead of silently weakening the Python side. |
| Every schema must be registered in `contracts`.      | Only registered schemas are generated. A test checks the registration, so a missing `.register(...)` is caught early.                                                                                            |
| Never edit generated files by hand.                  | The next `pnpm run generate` overwrites them, and `contracts:check` fails until the source matches.                                                                                                              |

## How the package is consumed

The package has no build step. `package.json` `exports` points at `src/index.ts`, and TypeScript source is read directly:

- `tsc` and Vitest in `apps/api` read the `.ts` files. Consumers need `allowImportingTsExtensions` and `erasableSyntaxOnly` in their tsconfig, because the source uses `.ts` import paths.
- `scripts/generate.ts` runs on Node 24's built-in type stripping (`node scripts/generate.ts`), the same way `infra` runs CDK.

## Files

| Path                  | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `src/registry.ts`     | The `contracts` registry: the list of schemas that get published |
| `src/*.ts`            | One file per contract                                            |
| `src/index.ts`        | Public exports                                                   |
| `scripts/generate.ts` | Registry → `schemas/*.json`                                      |
| `schemas/`            | Generated JSON Schema (committed, do not edit)                   |
| `test/`               | Tests for what each contract accepts and rejects                 |

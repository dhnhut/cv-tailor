# ADR-0003: Zod-First Contracts with Generated JSON Schema and Pydantic

| Field       | Value         |
| ----------- | ------------- |
| Status      | Accepted      |
| Date        | 2026-09-28    |
| Deciders    | Project owner |
| Sprint item | S0-04b        |

## Context

The TypeScript API (`apps/api`) and the Python agent service (`services/agents`) exchange payloads. [ADR-0001](0001-monorepo-pnpm-workspaces.md) decided that `packages/contracts` is the single source of these payload definitions, that code is generated for both languages, that generated files are committed, and that CI fails when they are out of date.

ADR-0001 assumed **JSON Schema as the hand-written source**, with codegen to Zod (TypeScript) and Pydantic (Python). Sprint 0 step 14 compared the codegen tools before building the pipeline. That research changed the direction of the pipeline, which is recorded here.

### Decision drivers

1. **Maintained tools.** Every tool must be actively maintained, so it can be kept for the long term.
2. **Fidelity.** Both languages must accept and reject the same payloads, including constraints such as `min`, `pattern`, and unknown keys.
3. **Static types in TypeScript.** The API must get compile-time types, not only runtime checks.
4. **Fewest tools.** Each tool must earn its place (the same driver as ADR-0001).
5. **Deterministic output.** The CI drift check compares regenerated files with committed ones, so the same input must always produce the same output.

### Findings (checked 2026-09-28)

| Tool                                         | Direction              | Status and quality                                                                                                                                                              |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json-schema-to-zod` 2.8.1                   | JSON Schema → Zod      | **Archived.** The README states it is no longer maintained as of March 2026. Last release April 2026.                                                                           |
| `quicktype` 26.0.0 (`--lang typescript-zod`) | JSON Schema → Zod      | Maintained, but its Zod renderer maps types only. It drops validation keywords (`minLength`, `pattern`, `maximum`, …) and renames types, so TS would validate less than Python. |
| Zod 4 `z.fromJSONSchema()`                   | JSON Schema → Zod      | Built into Zod, but documented as "semi-experimental". It works at runtime only and returns an untyped `ZodType`, so there are no static types.                                 |
| Zod 4 `z.toJSONSchema()` (zod 4.6.5)         | Zod → JSON Schema      | Built into Zod and stable. Supports draft 2020-12, registries of many schemas, cross-schema `$ref`s, and failing on unrepresentable features.                                   |
| `datamodel-code-generator` 0.83.0            | JSON Schema → Pydantic | Actively maintained, the de facto standard. Emits Pydantic v2, supports draft 2020-12, reads its config from `pyproject.toml`, and can run ruff on its output.                  |

On the Python side, `datamodel-code-generator` was the clear choice for every option. The open question was the TypeScript side.

## Options Considered

### Option A: JSON Schema first, `quicktype` for Zod

- **Pros:** keeps the direction of ADR-0001; the tool is maintained.
- **Cons:** the generated Zod loses constraints, which breaks driver 2. Hand-writing JSON Schema is verbose. It adds a large extra tool.

### Option B: JSON Schema first, `json-schema-to-zod` for Zod

- **Pros:** keeps the direction of ADR-0001; the best Zod output of the JSON Schema → Zod tools.
- **Cons:** the tool is archived, which breaks driver 1. A future Zod or JSON Schema change could break it with no fix available.

### Option C: JSON Schema first, `z.fromJSONSchema()` at runtime

- **Pros:** no extra tool.
- **Cons:** experimental, and no static types, which breaks driver 3.

### Option D: Zod first (chosen)

Contracts are written as Zod schemas. `z.toJSONSchema()` generates JSON Schema, and `datamodel-code-generator` generates Pydantic from that JSON Schema.

- **Pros**
  - No TypeScript codegen at all. The API imports the Zod schema directly, so TS has full static types and every constraint.
  - Both converters are maintained, and one of them is part of Zod itself.
  - JSON Schema is still produced and committed, as a language-neutral artifact that any future consumer can read.
  - Writing Zod is shorter and type-checked, which hand-written JSON Schema is not.
- **Cons**
  - Some Zod features have no JSON Schema form, so contracts can't use them. See "Rules" below.
  - The source of truth is TypeScript code, not a neutral format. A Python-only change to a contract must still be made in Zod.

## Decision

Use **Option D: Zod first.**

```text
packages/contracts/src/*.ts (Zod, source of truth)
   │  z.toJSONSchema  (packages/contracts/scripts/generate.ts)
   ▼
packages/contracts/schemas/*.json (JSON Schema draft 2020-12, committed)
   │  datamodel-code-generator  (config in services/agents/pyproject.toml)
   ▼
services/agents/src/cv_tailor_agents/contracts/*.py (Pydantic v2, committed)
```

Details:

- **Registry.** Each contract is added to a dedicated Zod registry (`contracts`), not to Zod's global registry. Only registered schemas are generated, so the registry is an explicit list of published contracts.
- **Names.** The registry `id` equals the TS export name (PascalCase). It becomes the JSON Schema `title`, which becomes the Python class name. The file name is the `id` in snake_case, which becomes the Python module name.
- **No build step.** The package exports its TypeScript source (`src/index.ts`). This matches the pattern in `infra`: Node 24 type stripping, with `allowImportingTsExtensions` in consumers.
- **Ordering.** `pnpm run generate` runs `packages/contracts` before `services/agents`. `services/agents` declares a workspace dev dependency on `@cv-tailor/contracts`, and `pnpm-workspace.yaml` has `generate: dependsOn: ['^generate']`. The same dependency makes `pnpm --filter "...[origin/main]"` select the agents when contracts change.
- **Determinism.** The Python generator runs with `disable-timestamp`, and both generators remove old output before writing, so a deleted contract leaves no stale file behind.
- **Drift check.** `pnpm run contracts:check` (`scripts/check-contracts.sh`) regenerates everything and fails if the result differs from the committed files. CI runs it (S0-05).

### Rules for contracts

| Rule                                                                                                | Reason                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Use `z.strictObject`, not `z.object`.                                                               | `z.object` strips unknown keys, but the generated Pydantic model (`extra="forbid"`) rejects them. `strictObject` makes both sides reject. |
| Don't use `.transform()`, `.refine()`, `.superRefine()`, `z.date()`, `z.bigint()`, or `z.custom()`. | JSON Schema can't express them. Generation runs with `unrepresentable: 'throw'`, so it fails instead of silently weakening Python.        |
| Test the same valid and invalid cases on both sides.                                                | Proves that TypeScript and Python accept and reject the same payloads.                                                                    |

## Consequences

### Positive

- One maintained converter per step, and no archived or experimental dependency.
- TypeScript keeps full static types and every constraint.
- A contract change breaks the TS compiler, the Python tests, and the drift check in the same run. This was verified by adding a field to `HealthResponse`.
- Descriptions written with `.describe()` become Python docstrings and `Field(description=...)`.

### Negative

- Contract authors must know the Zod subset that JSON Schema can express. The generator enforces it, and the package README documents it.
- Python has a two-step dependency on TypeScript tooling: changing a contract needs Node and pnpm, not only uv.
- Consumers of `@cv-tailor/contracts` need `allowImportingTsExtensions` and `erasableSyntaxOnly` in their tsconfig.

### Risks and mitigations

| Risk                                                                             | Mitigation                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A Zod or datamodel-code-generator upgrade changes the output format.             | Both are pinned in lockfiles. An upgrade PR regenerates the files, and the diff is reviewed like any other change. |
| A Zod feature is converted to JSON Schema differently from how Zod validates it. | Both sides test the same valid and invalid cases for every contract.                                               |
| The API later runs outside Vitest and `tsc` (for example as a bundled Lambda).   | Bundlers such as esbuild read TypeScript directly. This is checked when the first Lambda is deployed.              |

### When to revisit this decision

- A non-TypeScript team or service needs to own contracts. Then a neutral source (JSON Schema, or OpenAPI for HTTP APIs) may fit better.
- A maintained JSON Schema → Zod tool with full constraint support appears, and a neutral source becomes worth its cost.

## Verification

1. `pnpm run generate` writes `packages/contracts/schemas/health_response.json` and `services/agents/src/cv_tailor_agents/contracts/health_response.py`. A second run changes nothing.
2. `pnpm run check` passes, including mypy strict and ruff on the generated Python.
3. Adding a field to `HealthResponse` without regenerating makes `pnpm run contracts:check` fail. After regenerating, the API typecheck and the Python tests fail until both sides are updated.

## Sources

- [Zod: JSON Schema](https://zod.dev/json-schema)
- [json-schema-to-zod](https://github.com/StefanTerdell/json-schema-to-zod) (archived repository and deprecation notice)
- [quicktype](https://github.com/glideapps/quicktype)
- [datamodel-code-generator](https://github.com/koxudaxi/datamodel-code-generator)

# @cv-tailor/config

Shared TypeScript, ESLint, Prettier, and Vitest coverage config for every TypeScript package in this monorepo.

## TypeScript

| File                  | Use for                                      | Key settings                                                                                         |
| --------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tsconfig/base.json`  | Every package, through the files below       | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noEmit` |
| `tsconfig/node.json`  | Code that runs on Node (`apps/api`, `infra`) | `module` and `moduleResolution`: `NodeNext`                                                          |
| `tsconfig/react.json` | The browser app (`apps/web`)                 | `Bundler` resolution, `DOM` libs, `jsx: react-jsx`                                                   |

```json
{
  "extends": "@cv-tailor/config/tsconfig/node.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`base.json` sets `noEmit: true`, because Vite and esbuild produce the output. A package that emits with `tsc` turns emit back on in its own tsconfig.

## ESLint

`createConfig` returns a flat config with ESLint's recommended rules, typescript-eslint's type-checked rules, and `eslint-config-prettier`, which turns off formatting rules.

```js
// eslint.config.js
import { createConfig } from '@cv-tailor/config/eslint';

export default createConfig({ tsconfigRootDir: import.meta.dirname });
```

| Option            | Required             | Meaning                                                                                      |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `tsconfigRootDir` | Yes                  | The consuming package's folder. Type-aware rules find the nearest `tsconfig.json` from here. |
| `browser`         | No (default `false`) | Use browser globals instead of Node globals. Set it to `true` for `apps/web`.                |

Type-aware rules are turned off for plain `.js`, `.mjs`, and `.cjs` files, because those files have no type information.

## Prettier

Prettier runs once, from the repo root (`pnpm format`, `pnpm format:check`). The root `prettier.config.js` re-exports these options:

```js
export { default } from '@cv-tailor/config/prettier';
```

The options target Prettier 3 and change only `printWidth` (100) and `singleQuote`. Prettier is not a dependency of this package, because the config file is a plain object and never imports Prettier.

## Vitest coverage

`coverage()` returns the shared coverage settings: the v8 provider, a `text` and `html` report, and an 80% threshold for lines, statements, functions, and branches (`AGENTS.md` §9). If any of the four drops below 80%, `vitest run --coverage` fails. So does `pnpm run check`, which runs each package's `test` script, and with it the CI `check` job.

```ts
// vitest.config.ts
import { coverage } from '@cv-tailor/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { coverage: coverage({ include: ['src/**/*.ts'] }) },
});
```

| Option    | Required | Meaning                                                                       |
| --------- | -------- | ----------------------------------------------------------------------------- |
| `include` | Yes      | Globs for the package's shipped source files, relative to the package folder. |

`include` is required because Vitest's default counts only the files a test imports. An untested file would then never show up in the report, and the gate would pass without testing it.

Coverage is turned on by the `--coverage` flag in each package's `test` script (`vitest run --coverage`), not by `enabled: true`. `pnpm test` and `pnpm run check` always enforce the gate, while watch mode (`pnpm exec vitest`) stays fast. To run one test file without the gate, use `pnpm exec vitest run <file>`. `pnpm test -- <file>` measures only part of the code, so it fails the threshold.

The threshold is checked per package against the package's total, not per file. A per-file gate can be added later, once files are larger than a few lines.

### What is measured

| Package              | Measured (`include`)            | Not measured, and why                                                                                                                                                  |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`           | `src/**/*.ts`                   | None                                                                                                                                                                   |
| `apps/web`           | `src/**/*.{ts,tsx}`             | None. The entry point `main.tsx` has its own test (`test/main.test.tsx`).                                                                                              |
| `infra`              | `scripts/**/*.ts`               | The OpenTofu code, which `tofu test` checks instead (ADR-0013 §9). `web-config.ts`'s script entry point runs in a child process, which `test/web-config.test.ts` runs. |
| `packages/contracts` | `src/**/*.ts`                   | `scripts/generate.ts`: build tooling. CI runs it in `pnpm run contracts:check` and fails if its output changes.                                                        |
| `packages/config`    | Not gated                       | No runtime code, only tool config. Every other package's lint, typecheck, and test runs use it.                                                                        |
| `services/agents`    | `cv_tailor_agents` (pytest-cov) | `cv_tailor_agents/contracts/*`: generated from the Zod contracts. See [services/agents](../../services/agents/README.md#test-coverage).                                |

Test files, test helpers, and `*.config.ts` files are tooling, not shipped code, so `include` leaves them out. Generated contracts are the only shipped code that is excluded.

The `coverage/` folder that each run writes is gitignored and ignored by ESLint and Prettier.

## Version constraints

| Tool       | Range            | Reason                                                                                                                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript | `>=6.0.0 <6.1.0` | typescript-eslint 8.x supports TypeScript `<6.1.0`. TypeScript 7 (the native compiler) is not supported yet. Upgrade when typescript-eslint's peer range includes it.                |
| ESLint     | `^10.0.0`        | Flat config and `defineConfig` from `eslint/config`                                                                                                                                  |
| Node types | `@types/node` 24 | Matches the Lambda runtime and the root `engines` field (`>=24 <25`)                                                                                                                 |
| Vitest     | `^5.0.0`         | `coverage()` returns Vitest 5 `CoverageOptions`. Each package pins `@vitest/coverage-v8` to its exact `vitest` version, because the provider refuses to run against a different one. |

## Scripts

| Script                                      | What it checks                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm --filter @cv-tailor/config lint`      | Lints this package with its own ESLint config                                            |
| `pnpm --filter @cv-tailor/config typecheck` | Type-checks the config files (`.js` with `checkJs`, and `.ts`) with `tsconfig/node.json` |

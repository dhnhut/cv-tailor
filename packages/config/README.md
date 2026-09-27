# @cv-tailor/config

Shared TypeScript, ESLint, and Prettier config for every TypeScript package in this monorepo.

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

## Version constraints

| Tool       | Range            | Reason                                                                                                                                                                |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `>=6.0.0 <6.1.0` | typescript-eslint 8.x supports TypeScript `<6.1.0`. TypeScript 7 (the native compiler) is not supported yet. Upgrade when typescript-eslint's peer range includes it. |
| ESLint     | `^10.0.0`        | Flat config and `defineConfig` from `eslint/config`                                                                                                                   |
| Node types | `@types/node` 22 | Matches the Lambda runtime and the root `engines` field (`>=22 <23`)                                                                                                  |

## Scripts

| Script                                      | What it checks                                                        |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @cv-tailor/config lint`      | Lints this package with its own ESLint config                         |
| `pnpm --filter @cv-tailor/config typecheck` | Type-checks the JS config files (`checkJs`) with `tsconfig/node.json` |

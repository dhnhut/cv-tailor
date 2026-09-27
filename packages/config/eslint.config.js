import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat config for every TypeScript package.
 *
 * @param {object} options
 * @param {string} options.tsconfigRootDir  Folder of the consuming package; pass `import.meta.dirname`.
 * @param {boolean} [options.browser]       Use browser globals (web app) instead of Node globals.
 */
export function createConfig({ tsconfigRootDir, browser = false }) {
  return defineConfig(
    // 1. Never lint build output, coverage, or generated code.
    { ignores: ['**/dist/**', '**/cdk.out/**', '**/coverage/**', '**/*.gen.*'] },

    // 2. ESLint's core recommended rules (all files).
    js.configs.recommended,

    // 3. TypeScript rules that use type information (e.g. no-floating-promises).
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: browser ? globals.browser : globals.node,
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },

    // 4. Plain JS files (like this one) have no type info, so turn typed rules off for them.
    { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },

    // 5. Last: turn off every rule that conflicts with Prettier's formatting.
    prettier,
  );
}

// This package lints itself with its own config.
export default createConfig({ tsconfigRootDir: import.meta.dirname });

import { coverage } from '@cv-tailor/config/vitest';
import { defineConfig } from 'vitest/config';

// The TypeScript in infra: the deploy scripts and the organization policy checks. The OpenTofu
// code is tested with `tofu test` (scripts/tofu-each.sh, ADR-0013 §9).
export default defineConfig({
  test: {
    coverage: coverage({ include: ['scripts/**/*.ts'] }),
  },
});

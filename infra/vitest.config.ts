import { coverage } from '@cv-tailor/config/vitest';
import { defineConfig } from 'vitest/config';

const TEST_TIMEOUT = 30_000; // 30 seconds

export default defineConfig({
  test: {
    // Template.fromStack loads aws-cdk-lib and synthesizes in-process;
    // under parallel `pnpm run check` load this can exceed the 5 s default.
    testTimeout: TEST_TIMEOUT,
    coverage: coverage({ include: ['bin/**/*.ts', 'lib/**/*.ts', 'config/**/*.ts'] }),
  },
});

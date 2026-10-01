import { coverage } from '@cv-tailor/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { coverage: coverage({ include: ['src/**/*.ts'] }) },
});

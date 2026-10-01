import type { CoverageOptions } from 'vitest/node';

/** Coverage target for every package (AGENTS.md §9). */
export const COVERAGE_THRESHOLD = 80;

/**
 * Shared Vitest coverage settings.
 *
 * `include` is required: by default Vitest counts only files that a test imports,
 * so an untested file would be invisible and the gate would pass.
 */
export function coverage({ include }: { include: string[] }): CoverageOptions {
  return {
    provider: 'v8',
    include,
    reporter: ['text', 'html'], // text: table in the terminal and CI log; html: coverage/index.html
    thresholds: {
      lines: COVERAGE_THRESHOLD,
      statements: COVERAGE_THRESHOLD,
      functions: COVERAGE_THRESHOLD,
      branches: COVERAGE_THRESHOLD,
    },
  };
}

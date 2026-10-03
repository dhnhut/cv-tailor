import { afterEach, expect, test, vi } from 'vitest';

// This test builds every stage of every environment in one process, assets included. Under the
// parallel `pnpm run check` with coverage, that has passed 30 seconds since S2-06, and each
// new stack adds to it. Run alone, it takes far less (S2-09 measured it).
const BUILD_TIMEOUT = 120_000; // 2 minutes

afterEach(() => {
  vi.unstubAllEnvs();
});

// Smoke test: the CDK entry point runs. new App() writes nothing until synth(), so no files are left behind.
test(
  'bin/infra.ts builds the app in placeholder mode',
  async () => {
    vi.stubEnv('CVT_PLACEHOLDER_ACCOUNTS', '1');
    await expect(import('../bin/infra.ts')).resolves.toBeDefined();
  },
  BUILD_TIMEOUT,
);

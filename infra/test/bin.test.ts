import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

// Smoke test: the CDK entry point runs. new App() writes nothing until synth(), so no files are left behind.
test('bin/infra.ts builds the app in placeholder mode', async () => {
  vi.stubEnv('CVT_PLACEHOLDER_ACCOUNTS', '1');
  await expect(import('../bin/infra.ts')).resolves.toBeDefined();
});

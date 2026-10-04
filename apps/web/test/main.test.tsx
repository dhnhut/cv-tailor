// Testing Library's act, not React's: it sets IS_REACT_ACT_ENVIRONMENT for the call. Its own
// beforeAll hook for that needs Vitest globals, which this project doesn't use.
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEV_CONFIG } from './fixtures';

beforeEach(() => {
  vi.resetModules(); // main.tsx runs on import, so each test needs a fresh module
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const importMain = async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import('../src/main');
  });
};

// The only web test that imports the whole app while it runs: the router, the sign-in libraries,
// and every page, transformed for coverage. That takes about 0.5 s alone, but under the parallel
// `pnpm run check` it went past the 5 s default, as infra's synth tests did (infra/vitest.config.ts).
const IMPORTS_THE_APP_TIMEOUT = 30_000; // 30 seconds

test(
  'loads the settings, then mounts the app into #root',
  async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(DEV_CONFIG)));
    await importMain();
    expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
      HTMLHeadingElement,
    );
    expect(screen.getByText('dev')).toBeInstanceOf(HTMLParagraphElement);
    // main.tsx built a real UserManager. It reads session storage after the first render, so wait
    // for its signed-out state: the update then happens inside the test, with no act() warning.
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInstanceOf(
      HTMLButtonElement,
    );
  },
  IMPORTS_THE_APP_TIMEOUT,
);

test('shows an error instead of a blank page when the settings fail to load', async () => {
  const failure = new TypeError('Failed to fetch');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await importMain();
  expect(screen.getByRole('alert').textContent).toBe(
    "CV Tailor couldn't start. Please reload the page.",
  );

  expect(consoleError.mock.calls).toEqual([[failure]]); // exactly one call, with exactly this error
});

test('throws a clear error when #root is missing', async () => {
  await expect(import('../src/main')).rejects.toThrow('Root element #root not found');
});

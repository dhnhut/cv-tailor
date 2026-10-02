// Testing Library's act, not React's: it sets IS_REACT_ACT_ENVIRONMENT for the call. Its own
// beforeAll hook for that needs Vitest globals, which this project doesn't use.
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

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

test('loads the settings, then mounts the app into #root', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ environment: 'dev' })));
  await importMain();
  expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
    HTMLHeadingElement,
  );
  expect(screen.getByText('dev')).toBeInstanceOf(HTMLParagraphElement);
});

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

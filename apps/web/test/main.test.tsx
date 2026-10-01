import { act } from 'react';
import { screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules(); // main.tsx runs on import, so each test needs a fresh module
  document.body.innerHTML = '';
});

test('mounts the app into #root', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import('../src/main');
  });
  expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
    HTMLHeadingElement,
  );
});

test('throws a clear error when #root is missing', async () => {
  await expect(import('../src/main')).rejects.toThrow('Root element #root not found');
});

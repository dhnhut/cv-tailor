import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  sessionStorage.clear(); // tokens and sign-in state (settings.ts)
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

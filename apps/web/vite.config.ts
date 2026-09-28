import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Node resolves `localhost` to ::1 only in this container, but VS Code port forwarding
    // connects over IPv4. Bind to IPv4 loopback so forwarding works.
    host: '127.0.0.1',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});

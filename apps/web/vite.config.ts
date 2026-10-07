import { coverage } from '@cv-tailor/config/vitest';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Node resolves `localhost` to ::1 only in this container, but VS Code port forwarding
    // connects over IPv4. Bind to IPv4 loopback so forwarding works.
    host: '127.0.0.1',
    // The dev server has no config.json. It borrows the deployed dev environment's file, so
    // local runs use the dev settings and nothing is copied into the repo (S2-04).
    proxy: {
      '/config.json': { target: 'https://dev.cv.ikiwii.com', changeOrigin: true },
      // The API, called from localhost through this server: a server-to-server call has no CORS, so
      // dev's CORS can stay limited to the deployed web app (S2-09). Each API path is listed.
      '/me': { target: 'https://api.dev.cv.ikiwii.com', changeOrigin: true },
      // GET and POST /documents, and DELETE /documents/{id}: a key matches by prefix. The web app's
      // own /documents page (S3-09) has the same path, so a page load (Accept: text/html) is
      // served by Vite, not sent to the API.
      '/documents': {
        target: 'https://api.dev.cv.ikiwii.com',
        changeOrigin: true,
        bypass: (req) => (req.headers.accept?.includes('text/html') ? req.url : undefined),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: coverage({ include: ['src/**/*.{ts,tsx}'] }),
  },
});

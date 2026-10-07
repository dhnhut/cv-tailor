import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

// The SPA routing function (S2-04): runs the exact file CloudFront runs, in a fresh JavaScript
// context. App routes get index.html; files pass through.

type Handler = (event: { request: { uri: string } }) => { uri: string };
const code = readFileSync(new URL('../modules/web/spa-routing.js', import.meta.url), 'utf8');
const handler = runInNewContext(`${code}\nhandler;`) as Handler;

test.each([
  ['/', '/index.html'],
  ['/profile', '/index.html'],
  ['/applications/123', '/index.html'],
  ['/assets/index-a1b2c3.js', '/assets/index-a1b2c3.js'],
  ['/config.json', '/config.json'],
])('%s → %s', (uri, expected) => {
  expect(handler({ request: { uri } }).uri).toBe(expected);
});

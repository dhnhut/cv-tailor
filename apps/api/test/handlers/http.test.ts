import { expect, test } from 'vitest';
import { internalError, jsonResponse } from '../../src/handlers/http.ts';

const ORIGIN = 'https://dev.cv.ikiwii.com';

test('sends JSON with the CORS header, and is never cached', () => {
  expect(jsonResponse(200, { ok: true }, ORIGIN)).toEqual({
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': ORIGIN,
      'cache-control': 'no-store',
    },
    body: '{"ok":true}',
  });
});

test('a 500 has the gateway error shape and no detail', () => {
  const result = internalError(ORIGIN);

  expect(result.statusCode).toBe(500);
  expect(result.headers?.['access-control-allow-origin']).toBe(ORIGIN);
  expect(JSON.parse(result.body)).toEqual({ message: 'Internal server error' });
});

import { ApiErrorCode, ApiErrorResponse } from '@cv-tailor/contracts';
import { describe, expect, test } from 'vitest';
import { errorResponse, internalError, jsonResponse, noContent } from '../../src/handlers/http.ts';

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

describe('errorResponse', () => {
  test('a 4xx with a stable code, a fixed message, and the CORS header', () => {
    expect(errorResponse(409, 'storage-full', ORIGIN)).toEqual({
      statusCode: 409,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': ORIGIN,
        'cache-control': 'no-store',
      },
      body: '{"code":"storage-full","message":"Your knowledge base is full (50 MB)."}',
    });
  });

  // The web app reads the code. A code added to the contract without a message fails here.
  test.each(ApiErrorCode.options)('%s has a message', (code) => {
    const body = ApiErrorResponse.parse(JSON.parse(errorResponse(400, code, ORIGIN).body));
    expect(body.code).toBe(code);
    expect(body.message).not.toBe('');
  });
});

test('noContent is a 204 with no body, and the CORS header', () => {
  expect(noContent(ORIGIN)).toEqual({
    statusCode: 204,
    headers: { 'access-control-allow-origin': ORIGIN, 'cache-control': 'no-store' },
    body: '',
  });
});

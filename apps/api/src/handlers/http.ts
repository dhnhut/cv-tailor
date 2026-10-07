// JSON responses for the API's Lambda handlers (S2-09). Every response, errors included, carries
// the CORS header, or the browser hides it from the web app (ADR-0009 §6). The API allows one
// origin, so the header is static, and no Vary: Origin is needed.
import type { APIGatewayProxyResult } from 'aws-lambda';
import { type ApiErrorCode, ApiErrorResponse } from '@cv-tailor/contracts';

export const jsonResponse = (
  statusCode: number,
  body: unknown,
  allowedOrigin: string,
): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': allowedOrigin,
    'cache-control': 'no-store', // per-user data: no browser or proxy keeps a copy
  },
  body: JSON.stringify(body),
});

// The same shape as API Gateway's own errors ({"message":"Unauthorized"}), so the web app reads
// one shape. Never any detail: the reason is in the logs only.
export const internalError = (allowedOrigin: string): APIGatewayProxyResult =>
  jsonResponse(500, { message: 'Internal server error' }, allowedOrigin);

const MESSAGES: Record<ApiErrorCode, string> = {
  'invalid-request': 'The request is not valid.',
  forbidden: 'You are not allowed to do this.',
  'type-not-allowed': 'This file type is not supported.',
  'too-large': 'The file is larger than 50 MB.',
  'storage-full': 'Your knowledge base is full (50 MB).',
  'too-many-documents': 'Your knowledge base has the maximum number of documents.',
  'upload-in-progress': 'This document is still uploading. Try again later.',
  conflict: 'Another change is in progress. Try again.',
  'not-found': 'Not found.',
};

// A 4xx from our own code: a stable code for the web app, and a message with no values in it.
export const errorResponse = (statusCode: number, code: ApiErrorCode, allowedOrigin: string) =>
  jsonResponse(
    statusCode,
    ApiErrorResponse.parse({ code, message: MESSAGES[code] }),
    allowedOrigin,
  );

export const noContent = (allowedOrigin: string): APIGatewayProxyResult => ({
  statusCode: 204,
  headers: { 'access-control-allow-origin': allowedOrigin, 'cache-control': 'no-store' },
  body: '',
});

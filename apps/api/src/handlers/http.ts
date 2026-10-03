// JSON responses for the API's Lambda handlers (S2-09). Every response, errors included, carries
// the CORS header, or the browser hides it from the web app (ADR-0009 §6). The API allows one
// origin, so the header is static, and no Vary: Origin is needed.
import type { APIGatewayProxyResult } from 'aws-lambda';

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

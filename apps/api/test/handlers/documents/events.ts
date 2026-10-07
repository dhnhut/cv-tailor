import type { APIGatewayProxyEvent } from 'aws-lambda';
import { vi } from 'vitest';

// Shared by the document handler tests: events as API Gateway passes them after the Cognito
// authorizer, and the log lines a handler writes.

export const ORIGIN = 'https://dev.cv.ikiwii.com';
export const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';
export const AT = new Date('2026-10-07T09:15:00.000Z');
export const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': ORIGIN,
  'cache-control': 'no-store',
};

// Only the parts of the event the handlers read: the authorizer's claims, the body, and the path.
export const eventWith = (
  claims?: Record<string, unknown>,
  extra: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent =>
  ({
    requestContext: { authorizer: claims ? { claims } : undefined },
    ...extra,
  }) as unknown as APIGatewayProxyEvent;

export const accessToken = (extra: Partial<APIGatewayProxyEvent> = {}) =>
  eventWith({ sub: SUB, token_use: 'access', scope: 'cv-tailor-api/user' }, extra);

export const adminToken = (extra: Partial<APIGatewayProxyEvent> = {}) =>
  eventWith(
    { sub: SUB, token_use: 'access', scope: 'cv-tailor-api/user', 'cognito:groups': 'admin' },
    extra,
  );

// Silences console.log and console.error, and returns every line written, parsed.
export const captureLogs = () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return () =>
    [...log.mock.calls, ...error.mock.calls].map(([text]) => JSON.parse(text as string) as unknown);
};

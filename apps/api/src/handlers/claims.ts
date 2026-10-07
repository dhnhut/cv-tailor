// Who is calling, read from the claims that the API's Cognito authorizer passes to the Lambda
// (S2-09, ADR-0009 §6). Pure functions with no AWS calls. The authorizer has already checked the
// token's signature, expiry, and scope, so these claims can be trusted.
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Must match ADMIN_GROUP in infra/lib/auth-stack.ts (ADR-0009 §7).
export const ADMIN_GROUP = 'admin';

export interface Caller {
  readonly sub: string;
  readonly isAdmin: boolean;
}

// A REST API passes every claim as a string, so the token's cognito:groups array arrives
// flattened. AWS doesn't document the format: reports show "admin,editors", and older ones
// "[admin editors]". Both are accepted, and an array too, in case the format changes. Cognito
// group names can't contain whitespace, and our groups (defined only in OpenTofu) have no commas.
export function parseGroups(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((group): group is string => typeof group === 'string');
  }
  if (typeof value !== 'string') return [];
  const inner = value.trim().replace(/^\[(.*)\]$/s, '$1'); // one surrounding [ ], if any
  return inner.split(/[\s,]+/).filter((group) => group !== '');
}

// The caller, or undefined if the claims aren't what the authorizer gives for an access token.
// Undefined means the method is misconfigured (no authorizer, or no scope, so an ID token got
// through). Infra tests forbid both; this is the second line of defence.
export function readCaller(event: APIGatewayProxyEvent): Caller | undefined {
  const claims: unknown = event.requestContext.authorizer?.claims;
  if (typeof claims !== 'object' || claims === null) return undefined;

  const { sub, token_use: tokenUse, 'cognito:groups': groups } = claims as Record<string, unknown>;
  if (typeof sub !== 'string' || tokenUse !== 'access') return undefined;

  return { sub, isAdmin: parseGroups(groups).includes(ADMIN_GROUP) };
}

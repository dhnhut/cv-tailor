// GET /me (S2-09). Returns who the caller is, and creates their profile item on their first call
// (ADR-0009 §6, ADR-0006). API Gateway's Cognito authorizer has already refused any request
// without a valid access token carrying the API scope, so this handler only reads its claims.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { MeResponse } from '@cv-tailor/contracts';
import { dynamoProfileStore, type ProfileStore } from '../../data/profiles.ts';
import { requiredEnv } from '../../env.ts';
import { internalError, jsonResponse } from '../http.ts';
import { readCaller } from './claims.ts';

export interface MeDependencies {
  readonly store: ProfileStore;
  readonly allowedOrigin: string; // the web app's origin, for the CORS header
  readonly now?: () => Date;
}

// One JSON log line per request: the outcome and timing. Never the sub, a claim, a token, or the
// event (SAFE-04), as in the pre sign-up trigger.
export const createHandler =
  ({ store, allowedOrigin, now = () => new Date() }: MeDependencies) =>
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const started = now();
    const line = (fields: Record<string, unknown>) =>
      JSON.stringify({
        route: 'GET /me',
        ...fields,
        durationMs: now().getTime() - started.getTime(),
      });

    const caller = readCaller(event);
    if (!caller) {
      // Only a misconfigured method gets here (claims.ts). A 500, not a 401: it's our bug, not
      // the caller's, and it shows up in the 5XX metric instead of looking like a bad token.
      console.error(line({ outcome: 'no-claims' }));
      return internalError(allowedOrigin);
    }

    try {
      // The contract first: a body that breaks it is never sent, and nothing is written for it.
      const body = MeResponse.parse({ sub: caller.sub, isAdmin: caller.isAdmin });
      const outcome = await store.ensureProfile(caller.sub, started);
      console.log(line({ outcome, isAdmin: caller.isAdmin }));
      return jsonResponse(200, body, allowedOrigin);
    } catch (error) {
      // Only the error's name: messages can contain values, such as a key (S2-07 lesson).
      const name = error instanceof Error ? error.name : 'Unknown';
      console.error(line({ outcome: 'error', error: name }));
      return internalError(allowedOrigin);
    }
  };

// Read when the module loads (cold start), so a missing setting fails the first request.
const allowedOrigin = requiredEnv('ALLOWED_ORIGIN');
const tableName = requiredEnv('TABLE_NAME');

// Short timeouts and one retry: DynamoDB answers in milliseconds, and the web app is waiting.
// Two calls at worst (Get, then Put) fit inside the Lambda's 10-second timeout (api-stack.ts).
// Without throwOnRequestTimeout, the SDK only logs a warning when requestTimeout passes, and the
// request keeps running until the Lambda times out.
const client = new DynamoDBClient({
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 1_500, throwOnRequestTimeout: true },
});

export const handler = createHandler({
  store: dynamoProfileStore(client, tableName),
  allowedOrigin,
});

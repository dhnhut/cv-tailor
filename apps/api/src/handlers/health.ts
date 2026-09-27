import type { APIGatewayProxyResult } from 'aws-lambda';

export const handler = (): Promise<APIGatewayProxyResult> =>
  Promise.resolve({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  });

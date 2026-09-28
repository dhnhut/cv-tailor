import type { APIGatewayProxyResult } from 'aws-lambda';
import type { HealthResponse } from '@cv-tailor/contracts';

export const handler = (): Promise<APIGatewayProxyResult> => {
  const body: HealthResponse = { status: 'ok' };

  return Promise.resolve({
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

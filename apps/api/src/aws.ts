// The API's AWS clients, created once per Lambda container. The region comes from the Lambda's
// AWS_REGION.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

// Short timeouts and one retry: DynamoDB answers in milliseconds, and the web app is waiting.
// Without throwOnRequestTimeout, the SDK only logs a warning when requestTimeout passes, and the
// request keeps running until the Lambda times out.
export const dynamoClient = (): DynamoDBClient =>
  new DynamoDBClient({
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 1_000,
      requestTimeout: 1_500,
      throwOnRequestTimeout: true,
    },
  });

// The same, with a longer requestTimeout: an S3 list page is bigger than a DynamoDB item. No
// checksum settings: the presigned PUT carries our own SHA-256, so the SDK adds none of its own
// (checked with SDK 3.1146.0, S3-07). Exported so the bucket test presigns with these settings.
export const S3_CLIENT_CONFIG = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000, throwOnRequestTimeout: true },
} satisfies S3ClientConfig;

export const s3Client = (): S3Client => new S3Client(S3_CLIENT_CONFIG);

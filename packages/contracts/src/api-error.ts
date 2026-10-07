import * as z from 'zod';

// The body of every 4xx the API's own code returns. API Gateway's own errors stay
// {"message": "..."}, so the web app treats a missing code as "unknown".
export const ApiErrorCode = z.enum([
  'invalid-request',
  'forbidden',
  'type-not-allowed',
  'too-large',
  'storage-full',
  'too-many-documents',
  'upload-in-progress',
  'conflict',
  'not-found',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorResponse = z.strictObject({ code: ApiErrorCode, message: z.string() });
export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;

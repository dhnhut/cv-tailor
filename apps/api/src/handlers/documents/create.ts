// POST /documents (S3-07): reserve storage for a file, write its ACL file, and return a presigned
// upload. Admin only until the quota exists (Sprint 3 risk table, Sprint 6).
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateDocumentResponse, type CreateDocumentRequest } from '@cv-tailor/contracts';
import { createDocument, type CreateResult } from '../../documents/service.ts';
import { requiredEnv } from '../../env.ts';
import { readCaller } from '../claims.ts';
import { errorResponse, internalError, jsonResponse } from '../http.ts';
import { errorName, requestLog } from '../log.ts';
import { documentDependencies } from './dependencies.ts';
import { parseCreateRequest } from './request.ts';
import { summary } from './summary.ts';

export interface CreateDependencies {
  readonly create: (sub: string, request: CreateDocumentRequest) => Promise<CreateResult>;
  readonly allowedOrigin: string;
  readonly now?: () => Date;
}

export const createHandler =
  ({ create, allowedOrigin, now = () => new Date() }: CreateDependencies) =>
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const line = requestLog('POST /documents', now(), now);

    const caller = readCaller(event);
    if (!caller) {
      // Only a misconfigured method gets here (claims.ts): our bug, so a 500.
      console.error(line({ outcome: 'no-claims' }));
      return internalError(allowedOrigin);
    }
    if (!caller.isAdmin) {
      console.log(line({ outcome: 'forbidden' }));
      return errorResponse(403, 'forbidden', allowedOrigin);
    }

    const parsed = parseCreateRequest(event.body);
    if (!parsed.ok) {
      console.log(line({ outcome: parsed.code }));
      return errorResponse(400, parsed.code, allowedOrigin);
    }

    try {
      const result = await create(caller.sub, parsed.request);
      switch (result.outcome) {
        case 'created':
        case 'resumed': {
          // The contract first: a body that breaks it is never sent.
          const body = CreateDocumentResponse.parse({
            outcome: result.outcome,
            document: summary(result.document),
            upload: result.upload,
          });
          console.log(line({ outcome: result.outcome }));
          return jsonResponse(result.outcome === 'created' ? 201 : 200, body, allowedOrigin);
        }
        case 'unchanged': {
          const body = CreateDocumentResponse.parse({
            outcome: 'unchanged',
            document: summary(result.document),
          });
          console.log(line({ outcome: 'unchanged' }));
          return jsonResponse(200, body, allowedOrigin);
        }
        default:
          // storage-full, too-many-documents, or conflict: the request is fine, the state isn't.
          console.log(line({ outcome: result.outcome }));
          return errorResponse(409, result.outcome, allowedOrigin);
      }
    } catch (error) {
      console.error(line({ outcome: 'error', error: errorName(error) }));
      return internalError(allowedOrigin);
    }
  };

// Read when the module loads (cold start), so a missing setting fails the first request.
const service = documentDependencies();
export const handler = createHandler({
  create: (sub, request) => createDocument(service, sub, request),
  allowedOrigin: requiredEnv('ALLOWED_ORIGIN'),
});

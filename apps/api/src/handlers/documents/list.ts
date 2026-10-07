// GET /documents (S3-07): the caller's documents and their usage. Open to every signed-in user:
// it shows only their own documents, and releases their stale reservations (documents/service.ts).
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DocumentListResponse, MAX_DOCUMENTS, STORAGE_LIMIT_BYTES } from '@cv-tailor/contracts';
import type { StorageUsage, StoredDocument } from '../../data/documents.ts';
import { listDocuments } from '../../documents/service.ts';
import { requiredEnv } from '../../env.ts';
import { readCaller } from '../claims.ts';
import { internalError, jsonResponse } from '../http.ts';
import { errorName, requestLog } from '../log.ts';
import { documentDependencies } from './dependencies.ts';
import { summary } from './summary.ts';

export interface ListDependencies {
  readonly list: (sub: string) => Promise<{ documents: StoredDocument[]; usage: StorageUsage }>;
  readonly allowedOrigin: string;
  readonly now?: () => Date;
}

export const createHandler =
  ({ list, allowedOrigin, now = () => new Date() }: ListDependencies) =>
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const line = requestLog('GET /documents', now(), now);

    const caller = readCaller(event);
    if (!caller) {
      console.error(line({ outcome: 'no-claims' }));
      return internalError(allowedOrigin);
    }

    try {
      const { documents, usage } = await list(caller.sub);
      const body = DocumentListResponse.parse({
        documents: documents.map(summary),
        usedBytes: usage.usedBytes,
        limitBytes: STORAGE_LIMIT_BYTES,
        documentCount: usage.documentCount,
        maxDocuments: MAX_DOCUMENTS,
      });
      console.log(line({ outcome: 'listed', documents: documents.length }));
      return jsonResponse(200, body, allowedOrigin);
    } catch (error) {
      console.error(line({ outcome: 'error', error: errorName(error) }));
      return internalError(allowedOrigin);
    }
  };

const service = documentDependencies();
export const handler = createHandler({
  list: (sub) => listDocuments(service, sub),
  allowedOrigin: requiredEnv('ALLOWED_ORIGIN'),
});

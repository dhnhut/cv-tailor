// DELETE /documents/{id} (S3-07): remove a document, its ACL file, and its item, and free its
// bytes. Open to every signed-in user, so a former admin can still clean up. The S3 delete event
// starts the ingestion sync (S3-08).
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { deleteDocument, type DeleteOutcome } from '../../documents/service.ts';
import { requiredEnv } from '../../env.ts';
import { readCaller } from '../claims.ts';
import { errorResponse, internalError, noContent } from '../http.ts';
import { errorName, requestLog } from '../log.ts';
import { documentDependencies } from './dependencies.ts';

export interface DeleteDependencies {
  readonly remove: (sub: string, id: string) => Promise<DeleteOutcome>;
  readonly allowedOrigin: string;
  readonly now?: () => Date;
}

export const createHandler =
  ({ remove, allowedOrigin, now = () => new Date() }: DeleteDependencies) =>
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const line = requestLog('DELETE /documents/{id}', now(), now);

    const caller = readCaller(event);
    if (!caller) {
      console.error(line({ outcome: 'no-claims' }));
      return internalError(allowedOrigin);
    }

    try {
      // A missing ID can't happen behind this route. If it does, the service answers not-found.
      const outcome = await remove(caller.sub, event.pathParameters?.id ?? '');
      console.log(line({ outcome }));
      switch (outcome) {
        case 'deleted':
          return noContent(allowedOrigin);
        case 'not-found':
          // Also another user's document: the API never says whether an ID exists elsewhere.
          return errorResponse(404, 'not-found', allowedOrigin);
        default:
          // upload-in-progress or conflict
          return errorResponse(409, outcome, allowedOrigin);
      }
    } catch (error) {
      console.error(line({ outcome: 'error', error: errorName(error) }));
      return internalError(allowedOrigin);
    }
  };

const service = documentDependencies();
export const handler = createHandler({
  remove: (sub, id) => deleteDocument(service, sub, id),
  allowedOrigin: requiredEnv('ALLOWED_ORIGIN'),
});

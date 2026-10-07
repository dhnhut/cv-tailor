import { CreateDocumentRequest, type ApiErrorCode } from '@cv-tailor/contracts';

export type Parsed =
  | { readonly ok: true; readonly request: CreateDocumentRequest }
  | { readonly ok: false; readonly code: ApiErrorCode };

export function parseCreateRequest(body: string | null): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(body ?? '');
  } catch {
    return { ok: false, code: 'invalid-request' };
  }
  const result = CreateDocumentRequest.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues;
    // Only a type that was sent. A missing type also fails at path ['type'] (invalid_value, the
    // same code as a wrong one), but that is a malformed request, not an unsupported file.
    const sentType = typeof json === 'object' && json !== null && 'type' in json;
    if (sentType && issues.some((i) => i.path[0] === 'type'))
      return { ok: false, code: 'type-not-allowed' };
    if (issues.some((i) => i.path[0] === 'size' && i.code === 'too_big'))
      return { ok: false, code: 'too-large' };
    return { ok: false, code: 'invalid-request' };
  }
  // A cross-field check. Contracts don't use .refine (ADR-0003), so it lives here.
  if (!result.data.name.toLowerCase().endsWith(`.${result.data.type}`))
    return { ok: false, code: 'type-not-allowed' };
  return { ok: true, request: result.data };
}

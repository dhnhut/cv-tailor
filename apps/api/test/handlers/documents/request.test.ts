import { describe, expect, test } from 'vitest';
import { parseCreateRequest } from '../../../src/handlers/documents/request.ts';

// POST /documents' body (S3-07). The contract checks each field. This parser adds the JSON parse,
// the error code for each failure, and the name-and-type check the contract can't hold (ADR-0003:
// no .refine).

const SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const VALID = { name: 'cv.pdf', type: 'pdf', size: 1024, sha256: SHA256 };
const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...VALID, ...overrides });

describe('accepts', () => {
  test('a valid request', () => {
    expect(parseCreateRequest(body())).toEqual({ ok: true, request: VALID });
  });

  // Windows and cameras often write extensions in capitals. The type in the body is lowercase.
  test('a name whose extension is in capitals', () => {
    expect(parseCreateRequest(body({ name: 'CV.PDF' }))).toEqual({
      ok: true,
      request: { ...VALID, name: 'CV.PDF' },
    });
  });
});

describe('refuses', () => {
  test.each<[string, string | null, string]>([
    // Not a JSON object
    ['a missing body', null, 'invalid-request'],
    ['an empty body', '', 'invalid-request'],
    ['a body that is not JSON', '{"name":', 'invalid-request'],
    ['JSON null', 'null', 'invalid-request'],
    ['a JSON string', '"cv.pdf"', 'invalid-request'],
    ['a JSON array', '[]', 'invalid-request'],
    // Type (KB-03)
    ['a type not allowed', body({ name: 'run.exe', type: 'exe' }), 'type-not-allowed'],
    ['a type in capitals', body({ type: 'PDF' }), 'type-not-allowed'],
    ['a name that does not match the type', body({ name: 'cv.md' }), 'type-not-allowed'],
    ['a name without an extension', body({ name: 'cv' }), 'type-not-allowed'],
    ['a name ending in the type without a dot', body({ name: 'cvpdf' }), 'type-not-allowed'],
    // A missing type is a malformed request, not an unsupported file.
    [
      'a missing type',
      JSON.stringify({ name: 'cv.pdf', size: 1024, sha256: SHA256 }),
      'invalid-request',
    ],
    // Size (KB-03)
    ['one byte over 50 MB', body({ size: 50_000_001 }), 'too-large'],
    ['an empty file', body({ size: 0 }), 'invalid-request'],
    ['a size sent as a string', body({ size: '1024' }), 'invalid-request'],
    // Other fields
    ['a hash that is not SHA-256 hex', body({ sha256: 'abc' }), 'invalid-request'],
    ['a name with a path', body({ name: '../cv.pdf' }), 'invalid-request'],
    ['an unknown key', body({ key: 'kb/someone-else/x.pdf' }), 'invalid-request'],
    // Two problems: the type is reported first.
    [
      'a wrong type and a size over 50 MB',
      body({ type: 'exe', size: 50_000_001 }),
      'type-not-allowed',
    ],
  ])('%s with %s', (_, input, code) => {
    expect(parseCreateRequest(input)).toEqual({ ok: false, code });
  });
});

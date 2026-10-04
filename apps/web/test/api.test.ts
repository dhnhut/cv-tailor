import { afterEach, expect, test, vi } from 'vitest';
import { DEV_CONFIG } from './fixtures';
import { apiBase, ApiError, fetchMe } from '../src/api';

// The web app's GET /me call (S2-09). The body is checked against the shared contract.

const API_URL = 'https://api.dev.cv.ikiwii.com';
const SUB = '4f1c2b3a-9d8e-4f7a-b6c5-1a2b3c4d5e6f';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

// On the Vite dev server, API calls go to its own origin and the server proxies them to dev
// (vite.config.ts), because the API's CORS allows only the deployed web app (S2-09).
test('calls the API directly, except on the dev server, which proxies it', () => {
  expect(apiBase(DEV_CONFIG, false)).toBe('https://api.dev.cv.ikiwii.com');
  expect(apiBase(DEV_CONFIG, true)).toBe(window.location.origin);
});

test('asks the API who the caller is, with the access token', async () => {
  const fetchMock = stubFetch(Response.json({ sub: SUB, isAdmin: true }));

  await expect(fetchMe(API_URL, 'access-token')).resolves.toEqual({ sub: SUB, isAdmin: true });
  expect(fetchMock).toHaveBeenCalledWith('https://api.dev.cv.ikiwii.com/me', {
    headers: { Authorization: 'Bearer access-token' },
  });
});

test('builds the same URL when apiUrl ends with a slash', async () => {
  const fetchMock = stubFetch(Response.json({ sub: SUB, isAdmin: false }));

  await fetchMe(`${API_URL}/`, 'access-token');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.dev.cv.ikiwii.com/me');
});

test('fails with the status when the API refuses the call', async () => {
  stubFetch(Response.json({ message: 'Unauthorized' }, { status: 401 }));

  const call = fetchMe(API_URL, 'expired-token');
  await expect(call).rejects.toBeInstanceOf(ApiError);
  await expect(call).rejects.toMatchObject({
    name: 'ApiError',
    status: 401,
    message: 'API request failed: HTTP 401',
  });
});

// SAFE-04: if the API ever started returning an email address, the call fails here.
test('fails when the body breaks the contract', async () => {
  stubFetch(Response.json({ sub: SUB, isAdmin: false, email: 'alice@gmail.com' }));

  await expect(fetchMe(API_URL, 'access-token')).rejects.toThrow();
});

test('passes on a network failure', async () => {
  const failure = new TypeError('Failed to fetch');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));

  await expect(fetchMe(API_URL, 'access-token')).rejects.toBe(failure);
});

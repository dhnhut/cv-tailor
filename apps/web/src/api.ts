import { MeResponse, type WebConfig } from '@cv-tailor/contracts';

// Calls to the CV Tailor API (S2-09). Each call sends the access token, never the ID token: the
// API accepts access tokens only (ADR-0009 §6). S2-10 passes the signed-in user's token.

// A refused call, with its status, so the caller can act on it: 401 means sign in again.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API request failed: HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

// GET /me: who the signed-in user is. The body is checked against the shared contract, so a
// change on the API side shows up here as an error, not as a wrong value on screen.
export async function fetchMe(apiUrl: string, accessToken: string): Promise<MeResponse> {
  const response = await fetch(new URL('/me', apiUrl).href, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new ApiError(response.status);
  return MeResponse.parse(await response.json());
}

// Where API calls go. On the Vite dev server they go to its own origin, which proxies them to dev
// (vite.config.ts), because the API's CORS allows only the deployed web app (S2-09).
export const apiBase = (config: WebConfig, isDev: boolean): string =>
  isDev ? window.location.origin : config.apiUrl;

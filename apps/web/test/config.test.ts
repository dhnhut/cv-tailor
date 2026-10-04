import { afterEach, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { DEV_CONFIG as CONFIG } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

test('reads the settings from /config.json', async () => {
  const fetchMock = stubFetch(Response.json(CONFIG));
  await expect(loadConfig()).resolves.toEqual(CONFIG);
  expect(fetchMock).toHaveBeenCalledWith('/config.json');
});

test('fails with the status when the file is missing', async () => {
  stubFetch(new Response('AccessDenied', { status: 403 }));
  await expect(loadConfig()).rejects.toThrow("Couldn't load /config.json: HTTP 403");
});

test('fails when the settings have the wrong shape', async () => {
  stubFetch(Response.json({ ...CONFIG, environment: 'test' }));
  await expect(loadConfig()).rejects.toThrow();
});

// A config.json written before S2-09 has no apiUrl. The app refuses it rather than start without
// an API.
test('fails when the API URL is missing', async () => {
  stubFetch(Response.json({ environment: 'dev' }));
  await expect(loadConfig()).rejects.toThrow();
});

// A config.json written before S2-10 has no sign-in settings. The app refuses it rather than
// start without sign-in.
test('fails when the sign-in settings are missing', async () => {
  stubFetch(Response.json({ environment: 'dev', apiUrl: CONFIG.apiUrl }));
  await expect(loadConfig()).rejects.toThrow();
});

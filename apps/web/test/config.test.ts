import { afterEach, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

test('reads the settings from /config.json', async () => {
  const fetchMock = stubFetch(Response.json({ environment: 'dev' }));
  await expect(loadConfig()).resolves.toEqual({ environment: 'dev' });
  expect(fetchMock).toHaveBeenCalledWith('/config.json');
});

test('fails with the status when the file is missing', async () => {
  stubFetch(new Response('AccessDenied', { status: 403 }));
  await expect(loadConfig()).rejects.toThrow("Couldn't load /config.json: HTTP 403");
});

test('fails when the settings have the wrong shape', async () => {
  stubFetch(Response.json({ environment: 'test' }));
  await expect(loadConfig()).rejects.toThrow();
});

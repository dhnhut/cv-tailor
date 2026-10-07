import { expect, test } from 'vitest';
import { errorName, requestLog } from '../../src/handlers/log.ts';

test('a log line holds the route, the fields, and the time since the start', () => {
  const started = new Date('2026-10-07T09:15:00.000Z');
  const line = requestLog('GET /documents', started, () => new Date('2026-10-07T09:15:00.250Z'));

  expect(JSON.parse(line({ outcome: 'listed', documents: 2 }))).toEqual({
    route: 'GET /documents',
    outcome: 'listed',
    documents: 2,
    durationMs: 250,
  });
});

test.each([
  [
    'an Error, by its name',
    Object.assign(new Error('USER#secret'), { name: 'Throttled' }),
    'Throttled',
  ],
  ['anything else, as Unknown', 'USER#secret', 'Unknown'],
])('names %s, never its message', (_, error, name) => {
  expect(errorName(error)).toBe(name);
});

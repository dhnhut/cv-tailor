// One JSON log line per request: the route, what happened, and the time taken. Callers pass only
// outcomes and counts, never the sub, a claim, a token, a file name, or the event (SAFE-04).
export const requestLog =
  (route: string, started: Date, now: () => Date) => (fields: Record<string, unknown>) =>
    JSON.stringify({ route, ...fields, durationMs: now().getTime() - started.getTime() });

// Only the error's name: messages can contain values, such as a key (S2-07 lesson).
export const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'Unknown';

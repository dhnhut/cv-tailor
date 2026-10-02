import type { WebConfig } from '@cv-tailor/contracts';

export function App({ config }: { config: WebConfig }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-3xl font-bold">CV Tailor</h1>
      {config.environment !== 'prod' && (
        <p className="text-sm text-gray-500">{config.environment}</p>
      )}
    </main>
  );
}

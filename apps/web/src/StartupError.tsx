// Shown when the app can't load its settings, instead of a blank page.
export function StartupError() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p role="alert">CV Tailor couldn't start. Please reload the page.</p>
    </main>
  );
}

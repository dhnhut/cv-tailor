import { useAuth } from 'react-oidc-context';
import { Navigate, useLocation } from 'react-router';
import { GENERIC_SIGN_IN_ERROR, signInErrorMessage } from '../auth/callback-error';

// Managed login sends the browser here (S2-05). A success is handled by AuthProvider, which
// exchanges the code and then leaves this page (App.tsx). This page shows the waiting and failure
// states.
export function CallbackPage() {
  const auth = useAuth();
  // The router's URL, never window.location: React Router 8 applies navigation as a transition,
  // so right after a sign-in window.location already shows the next page while this one renders
  // a last time. Read from there, it would look like a visit with no parameters and send the
  // person home.
  const { search } = useLocation();

  // Read here, not left to the library: a refused Google sign-in may come back without `state`,
  // and then the library doesn't process the URL at all (ADR-0009 §2).
  const refusal = signInErrorMessage(search);
  if (refusal !== null || auth.error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3">
        <p>{refusal ?? GENERIC_SIGN_IN_ERROR}</p>
        {/* A new sign-in, never a retry: a failed exchange uses up the code (S2-05). */}
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => void auth.signinRedirect()}
        >
          Try again
        </button>
      </div>
    );
  }
  // The same test as the library's hasAuthParams(), on the router's URL.
  const params = new URLSearchParams(search);
  const signInInProgress = params.has('state') && (params.has('code') || params.has('error'));
  if (!auth.isLoading && !signInInProgress) return <Navigate to="/" replace />;
  return <p>Signing you in…</p>;
}

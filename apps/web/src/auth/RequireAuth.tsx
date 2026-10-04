import { type ReactNode, useEffect, useRef } from 'react';
import { useAuth } from 'react-oidc-context';
import { useLocation } from 'react-router';

// Protects a page: a signed-out visitor goes to sign-in and comes back here afterwards (S2-10).
// An expired session counts as signed out.
export function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const auth = useAuth();
  const { pathname } = useLocation();
  const started = useRef(false);
  const mustSignIn = !auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator;

  useEffect(() => {
    // Once per visit: StrictMode runs effects twice in development, and the provider's state
    // changes again while the redirect starts.
    if (mustSignIn && !started.current) {
      started.current = true;
      void auth.signinRedirect({ state: { returnTo: pathname } });
    }
  }, [mustSignIn, auth, pathname]);

  if (auth.isAuthenticated) return children;
  if (auth.error?.source === 'signinRedirect') {
    return <p role="alert">Couldn't open the sign-in page. Please reload.</p>;
  }
  return <p>Redirecting to sign-in…</p>;
}

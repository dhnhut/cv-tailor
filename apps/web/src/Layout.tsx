import type { WebConfig } from '@cv-tailor/contracts';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useLocation, useNavigate } from 'react-router';
import { signOut } from './auth/sign-out';

// The header on every page: the app name, the environment outside prod, and, once signed in, the
// email address from the ID token (the API never sees it, ADR-0009 §6) and Sign out.
export function Layout({ config, children }: { config: WebConfig; children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const signOutStarted = useRef(false);

  // Sign-out starts only once the home page is on screen. React Router 8 applies navigation as a
  // transition, which lands after other state changes. If the tokens were cleared first, a page
  // that requires sign-in would still be showing, start a new sign-in, and race the redirect to
  // /logout. The ref keeps it to one run, because `auth` changes while it signs out.
  useEffect(() => {
    if (signingOut && pathname === '/' && !signOutStarted.current) {
      signOutStarted.current = true;
      void signOut(auth, config);
    }
  }, [signingOut, pathname, auth, config]);

  const onSignOut = () => {
    setSigningOut(true);
    void navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold">
            <Link to="/">CV Tailor</Link>
          </h1>
          {config.environment !== 'prod' && (
            <p className="text-sm text-gray-500">{config.environment}</p>
          )}
        </div>
        {auth.isAuthenticated && (
          <div className="flex items-center gap-3 text-sm">
            <span>{auth.user?.profile.email}</span>
            <button
              type="button"
              className="rounded border px-3 py-1"
              disabled={signingOut}
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">{children}</main>
    </div>
  );
}

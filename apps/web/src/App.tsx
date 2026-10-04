import type { WebConfig } from '@cv-tailor/contracts';
import type { User, UserManager } from 'oidc-client-ts';
import { type ReactNode, useCallback } from 'react';
import { AuthProvider } from 'react-oidc-context';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { apiBase } from './api';
import { RequireAuth } from './auth/RequireAuth';
import { returnPath } from './auth/return-path';
import { CALLBACK_PATH } from './auth/settings';
import { Layout } from './Layout';
import { CallbackPage } from './pages/CallbackPage';
import { HomePage } from './pages/HomePage';
import { ProfilePage } from './pages/ProfilePage';

export interface AppProps {
  readonly config: WebConfig;
  readonly userManager: UserManager; // built once in main.tsx; tests pass their own
}

// App routes must never end in a segment with a dot: CloudFront serves those as files (S2-04).
export function App({ config, userManager }: AppProps) {
  return (
    <BrowserRouter>
      <AuthWithRouter userManager={userManager}>
        <Layout config={config}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path={CALLBACK_PATH} element={<CallbackPage />} />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage apiBase={apiBase(config, import.meta.env.DEV)} />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AuthWithRouter>
    </BrowserRouter>
  );
}

// Inside the router, so a finished sign-in moves to its page without reloading. `replace` also
// takes ?code=… out of the address bar and the history.
function AuthWithRouter({
  userManager,
  children,
}: {
  userManager: UserManager;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const onSigninCallback = useCallback(
    (user: User | undefined) => navigate(returnPath(user?.state), { replace: true }),
    [navigate],
  );
  return (
    <AuthProvider userManager={userManager} onSigninCallback={onSigninCallback}>
      {children}
    </AuthProvider>
  );
}

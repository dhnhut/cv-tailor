import type { MeResponse } from '@cv-tailor/contracts';
import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, fetchMe } from '../api';

type MeState = { status: 'loading' } | { status: 'loaded'; me: MeResponse } | { status: 'failed' };

// Who the signed-in person is: the email from the ID token, and the sub and role from GET /me,
// called with the access token (S2-09, ADR-0009 §6). Rendered inside RequireAuth.
export function ProfilePage({ apiBase }: { apiBase: string }) {
  const auth = useAuth();
  const token = auth.user?.access_token;
  const [state, setState] = useState<MeState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let ignore = false; // a newer call, or leaving the page, makes this answer stale
    fetchMe(apiBase, token).then(
      (me) => {
        if (!ignore) setState({ status: 'loaded', me });
      },
      async (error: unknown) => {
        if (ignore) return;
        if (error instanceof ApiError && error.status === 401) {
          // The API refused the token (expired or revoked). Clearing it makes RequireAuth start
          // a new sign-in that returns here.
          await auth.removeUser();
          return;
        }
        console.error(error);
        setState({ status: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [apiBase, token, attempt, auth]);

  if (state.status === 'loading') return <p>Loading your profile…</p>;
  if (state.status === 'failed') {
    return (
      <div role="alert" className="flex flex-col items-center gap-3">
        <p>Couldn't load your profile.</p>
        <button
          type="button"
          className="rounded border px-3 py-1"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt className="font-semibold">Email</dt>
      <dd>{auth.user?.profile.email}</dd>
      <dt className="font-semibold">User ID</dt>
      <dd className="font-mono text-sm">{state.me.sub}</dd>
      <dt className="font-semibold">Role</dt>
      <dd>{state.me.isAdmin ? 'Admin' : 'Candidate'}</dd>
    </dl>
  );
}

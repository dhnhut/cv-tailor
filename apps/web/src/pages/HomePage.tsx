import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router';

export function HomePage() {
  const auth = useAuth();
  if (auth.isLoading) return <p>Loading…</p>;
  if (auth.isAuthenticated) return <Link to="/profile">Your profile</Link>;
  return (
    <button
      type="button"
      className="rounded bg-black px-4 py-2 text-white"
      onClick={() => void auth.signinRedirect({ state: { returnTo: '/profile' } })}
    >
      Sign in
    </button>
  );
}

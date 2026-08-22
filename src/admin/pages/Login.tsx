import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAdminAuthStore } from '../../store/adminAuthStore';
import { Button, ErrorNote, Field, Input } from '../components/ui';

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading, error, login } = useAdminAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Bounce straight through if an existing session is already valid.
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const to = (location.state as { from?: string } | null)?.from ?? '/admin/dashboard';
      navigate(to, { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, location.state]);

  if (isAuthenticated && !isLoading) return <Navigate to="/admin/dashboard" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const ok = await login(email.trim(), password);
    setSubmitting(false);

    if (ok) {
      const to = (location.state as { from?: string } | null)?.from ?? '/admin/dashboard';
      navigate(to, { replace: true });
    }
  };

  return (
    <>
      <Helmet>
        <title>Admin sign in — DENIMQUE</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <div className="flex min-h-screen items-center justify-center bg-obsidian px-4 text-pearl">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span className="block font-display text-3xl">DENIMQUE</span>
            <span className="text-meta uppercase text-fog">Control Center</span>
          </div>

          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded border border-stone/40 bg-charcoal p-6"
          >
            {error && <ErrorNote message={error} />}

            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </Field>

            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={submitting || !email || !password}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-fog">
            Administrator access only. All actions are logged.
          </p>
        </div>
      </div>
    </>
  );
}

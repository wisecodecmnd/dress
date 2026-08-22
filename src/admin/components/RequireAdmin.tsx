import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAdminAuthStore } from '../../store/adminAuthStore';

/**
 * Route guard. This is convenience only — it stops a non-admin seeing admin
 * chrome, but every /api/admin endpoint enforces the role server-side, so a
 * user who bypasses this sees empty screens and 403s, not data.
 */
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, init } = useAdminAuthStore();
  const location = useLocation();

  useEffect(() => {
    // Revalidate the session against the server on first mount.
    if (!isAuthenticated) void init();
  }, [isAuthenticated, init]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-obsidian">
        <span className="text-meta uppercase text-fog">Checking access</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

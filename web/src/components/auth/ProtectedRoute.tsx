import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/auth';

/**
 * A route that needs a signed-in user.
 *
 * It waits for the restore attempt before deciding. Redirecting while the
 * session is still being restored would bounce a signed-in user to the login
 * page on every page load, which is the classic bug in this pattern.
 *
 * This is convenience, not security: every endpoint behind it checks the
 * token itself, and the admin ones check the role. A route guard in React
 * decides what to render, never what someone is allowed to do.
 */
export function ProtectedRoute({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: 'ADMIN';
}) {
  const { user, restoring } = useAuthStore();
  const location = useLocation();

  if (restoring) {
    return (
      <div className="mx-auto flex min-h-[60svh] max-w-page flex-col items-center justify-center gap-4 px-gutter">
        <Spinner className="size-5 text-muted" />
        <Label>Restoring your session</Label>
      </div>
    );
  }

  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

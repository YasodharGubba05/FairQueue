import { useEffect } from 'react';
import { refreshSession } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Restores the session on load.
 *
 * Nothing about the session is stored in the browser, so on a fresh page the
 * app genuinely does not know who you are. It asks the server, which reads the
 * HttpOnly refresh cookie and mints a new access token. Signed in, you stay
 * signed in across a reload; signed out, the call simply fails and the app
 * carries on as a visitor.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const setRestoring = useAuthStore((s) => s.setRestoring);

  useEffect(() => {
    let cancelled = false;
    setRestoring(true);

    void refreshSession().finally(() => {
      if (!cancelled) setRestoring(false);
    });

    return () => {
      cancelled = true;
    };
  }, [setRestoring]);

  // Children render immediately. Public pages should not wait on a session
  // they do not need; the ones that do, wait in ProtectedRoute instead.
  return <>{children}</>;
}

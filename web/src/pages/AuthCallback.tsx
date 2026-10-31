import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { Label } from '@/components/ui/label';
import { refreshSession } from '@/lib/api';

/**
 * Where Google sign-in lands.
 *
 * The server has already verified everything and set the refresh cookie; the
 * access token was deliberately not put in the URL, because a query string
 * ends up in browser history and server logs. So this page just asks for a
 * token using the cookie it now holds, and moves on.
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const requested = params.get('returnTo') ?? '/';
    // Only a path, never an absolute URL: honouring one would make this an
    // open redirect.
    const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

    void refreshSession().then((token) => {
      if (token) navigate(next, { replace: true });
      else setFailed(true);
    });
  }, [params, navigate]);

  if (failed) {
    navigate('/login?error=sign_in_failed', { replace: true });
    return null;
  }

  return (
    <div className="mx-auto flex min-h-[60svh] max-w-page flex-col items-center justify-center gap-4 px-gutter">
      <Spinner className="size-5 text-muted" />
      <Label>Signing you in</Label>
    </div>
  );
}

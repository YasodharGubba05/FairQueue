import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { FieldLabel, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type SessionUser } from '@/store/auth';

type LoginResponse = { accessToken: string; expiresIn: number; user: SessionUser };

const DEMO_ACCOUNTS = [
  { label: 'Buyer', email: 'buyer0001@fairqueue.dev', password: 'password123' },
  { label: 'Admin', email: 'admin@fairqueue.dev', password: 'admin123' },
];

/** What came back on the URL after a failed provider sign-in, in plain words. */
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Google sign-in.',
  invalid_state: 'That sign-in link had expired. Try again.',
  sign_in_failed: 'Google sign-in did not complete. Try again.',
  not_configured: 'Google sign-in is not set up on this server.',
  missing_parameters: 'Google sent an incomplete response. Try again.',
};

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const user = useAuthStore((s) => s.user);

  const [email, setEmail] = useState('buyer0001@fairqueue.dev');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  const next = params.get('next') ?? '/';

  // Surface whatever the provider redirect complained about.
  useEffect(() => {
    const oauthError = params.get('error');
    if (oauthError) setError(OAUTH_ERRORS[oauthError] ?? 'Sign-in did not complete.');
  }, [params]);

  // The button only appears if the server actually has credentials, so it can
  // never be a link to a 501.
  useEffect(() => {
    api
      .get<{ google: boolean }>('/api/auth/providers')
      .then((res) => setGoogleAvailable(res.google))
      .catch(() => setGoogleAvailable(false));
  }, []);

  // Already signed in — nothing to do here.
  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  async function submit(withEmail = email, withPassword = password) {
    setPending(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/api/auth/login', {
        email: withEmail,
        password: withPassword,
      });
      setSession({ accessToken: res.accessToken, user: res.user });
      navigate(next, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 429
            ? 'Too many attempts. Wait a moment and try again.'
            : err.message
          : 'Could not reach the server',
      );
    } finally {
      setPending(false);
    }
  }

  function startGoogle() {
    // A full page navigation, not fetch: the browser has to follow the
    // redirect to Google and come back with a cookie.
    window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(next)}`;
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-var(--spacing-nav,4.5rem))] w-full max-w-reading flex-col justify-center px-gutter py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.52, ease: [0.22, 0.61, 0.36, 1] }}
        className="flex flex-col gap-10"
      >
        <div className="flex flex-col gap-4">
          <Label>Sign in</Label>
          <h1 className="font-display text-display-sm">One queue spot per account</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            That is what keeps the line fair — a bot wanting more throughput has to bring more
            accounts, and every one of them still waits its turn.
          </p>
        </div>

        {error ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            role="alert"
            className="border-l border-danger pl-4 text-sm leading-relaxed text-danger"
          >
            {error}
          </motion.p>
        ) : null}

        {googleAvailable ? (
          <div className="flex flex-col gap-6">
            <Button
              type="button"
              variant="solid"
              size="lg"
              onClick={startGoogle}
              disabled={pending}
              className="w-full"
            >
              <GoogleMark />
              Continue with Google
            </Button>

            <div className="flex items-center gap-4">
              <span className="h-px flex-1 bg-[hsl(var(--line)/var(--line-alpha))]" />
              <Label>or</Label>
              <span className="h-px flex-1 bg-[hsl(var(--line)/var(--line-alpha))]" />
            </div>
          </div>
        ) : null}

        <form
          className="flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            variant={googleAvailable ? 'outline' : 'solid'}
            size="lg"
            disabled={pending}
          >
            {pending ? <Spinner /> : null}
            {pending ? 'Signing in' : 'Sign in with email'}
          </Button>
        </form>

        <div className="flex flex-col gap-4 border-t pt-8">
          <Label>Demo accounts</Label>
          <div className="flex gap-3">
            {DEMO_ACCOUNTS.map((acct) => (
              <Button
                key={acct.email}
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setEmail(acct.email);
                  setPassword(acct.password);
                  void submit(acct.email, acct.password);
                }}
              >
                {acct.label}
              </Button>
            ))}
          </div>
        </div>

        <Link to="/" className="rounded-sm text-sm text-muted hover:text-foreground">
          Back to events
        </Link>
      </motion.div>
    </div>
  );
}

/** Google's mark, drawn inline so the page loads no third-party asset. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

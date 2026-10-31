import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertCircle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type SessionUser } from '@/store/auth';

type LoginResponse = { token: string; user: SessionUser };

/** Seeded accounts, so the demo is one click away. */
const DEMO_ACCOUNTS = [
  { label: 'Buyer', email: 'buyer0001@fairqueue.dev', password: 'password123' },
  { label: 'Admin', email: 'admin@fairqueue.dev', password: 'admin123' },
];

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('buyer0001@fairqueue.dev');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Where to land after signing in: back where the user was sent from, or home.
  const next = params.get('next') ?? '/';

  async function submit(withEmail = email, withPassword = password) {
    setPending(true);
    setError(null);
    try {
      const res = await api.post<LoginResponse>('/api/auth/login', {
        email: withEmail,
        password: withPassword,
      });
      setSession(res);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-gutter py-12 sm:py-20">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <Card>
          <CardHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-xl bg-gradient-to-br from-accent to-highlight text-accent-foreground shadow-glow">
              <LogIn className="size-5" aria-hidden />
            </span>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              You need an account to take a place in line — one queue spot per account.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              ) : null}

              <Button type="submit" variant="gradient" size="lg" disabled={pending}>
                {pending ? <Spinner /> : null}
                {pending ? 'Signing in' : 'Sign in'}
              </Button>
            </form>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-xs uppercase tracking-wide text-muted">Demo accounts</p>
              <div className="flex flex-wrap gap-2">
                {DEMO_ACCOUNTS.map((acct) => (
                  <Button
                    key={acct.email}
                    type="button"
                    variant="secondary"
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
          </CardContent>
        </Card>
      </motion.div>

      <p className="mt-6 text-center text-sm text-muted">
        <Link to="/" className="text-accent hover:underline">
          Back to events
        </Link>
      </p>
    </div>
  );
}

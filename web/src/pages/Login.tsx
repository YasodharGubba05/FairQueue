import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { FieldLabel, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type SessionUser } from '@/store/auth';

type LoginResponse = { token: string; user: SessionUser };

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

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="solid" size="lg" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? 'Signing in' : 'Sign in'}
          </Button>
        </form>

        <div className="flex flex-col gap-4 border-t pt-8">
          <Label>Demo accounts</Label>
          <div className="flex gap-3">
            {DEMO_ACCOUNTS.map((acct) => (
              <Button
                key={acct.email}
                type="button"
                variant="outline"
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

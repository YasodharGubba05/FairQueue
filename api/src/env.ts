import { z } from 'zod';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://fairqueue:fairqueue@localhost:5432/fairqueue?schema=public';
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(1).default('dev-only-change-me'),
  // naive: the deliberately broken "before" build used for benchmarks.
  MODE: z.enum(['naive', 'fairqueue']).default('fairqueue'),
  // Render and most hosts inject PORT; API_PORT is the local convention.
  // Whichever is set wins, so the same image runs in both places.
  API_PORT: z.coerce.number().default(4000),
  PORT: z.coerce.number().optional(),
  // Kubernetes injects the pod name; Mission Control counts live pods from it.
  POD_NAME: z.string().default('api-local'),
  NODE_ENV: z.string().default('development'),
  // How much looser the per-address limit is than the per-account one. Raised
  // for benchmark runs, where every virtual user shares the load generator's
  // single address.
  RATE_LIMIT_IP_FACTOR: z.coerce.number().default(20),
  // Live events. Optional by design: with no key the application runs exactly
  // as before on its seeded catalogue, which is what keeps it demoable and
  // benchmarkable on a machine with no credentials and no network.
  TICKETMASTER_API_KEY: z.string().optional(),
  // Which country to pull live events for, and how many per sync.
  EVENT_SYNC_COUNTRY: z.string().default('GB'),
  EVENT_SYNC_LIMIT: z.coerce.number().default(24),
  // What to pull. "Music" keeps the catalogue to concerts and live shows
  // rather than whatever happens to be on in the country that week.
  EVENT_SYNC_CLASSIFICATION: z.string().default('Music'),
  // How often to refresh live events. 0 turns the scheduled sync off entirely,
  // which is what the benchmarks run with so a provider call can never land in
  // the middle of a measured window.
  EVENT_SYNC_INTERVAL_MINUTES: z.coerce.number().default(360),
  // Off only for the suites that test the locking guarantees, where thousands
  // of requests arrive from one address on purpose and the limiter is not what
  // is under test. Never off in a running deployment.
  // Pinned into every access token, so one minted elsewhere cannot be replayed.
  TOKEN_ISSUER: z.string().default('fairqueue'),
  TOKEN_AUDIENCE: z.string().default('fairqueue-api'),
  // Dropped on plain-http local development, where a Secure cookie would be
  // refused by the browser and nothing would work.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Google sign-in. Optional: with no credentials the button is hidden and
  // password login carries on exactly as before.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default('http://localhost:4000/api/auth/google/callback'),
  // Where the browser lands once sign-in finishes.
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  // A host-provided PORT always wins over the local default.
  API_PORT: parsed.data.PORT ?? parsed.data.API_PORT,
};
export const isNaive = env.MODE === 'naive';

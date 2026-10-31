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
  API_PORT: z.coerce.number().default(4000),
  // Kubernetes injects the pod name; Mission Control counts live pods from it.
  POD_NAME: z.string().default('api-local'),
  NODE_ENV: z.string().default('development'),
  // How much looser the per-address limit is than the per-account one. Raised
  // for benchmark runs, where every virtual user shares the load generator's
  // single address.
  RATE_LIMIT_IP_FACTOR: z.coerce.number().default(20),
  // Off only for the suites that test the locking guarantees, where thousands
  // of requests arrive from one address on purpose and the limiter is not what
  // is under test. Never off in a running deployment.
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

export const env = parsed.data;
export const isNaive = env.MODE === 'naive';

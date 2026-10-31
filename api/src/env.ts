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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isNaive = env.MODE === 'naive';

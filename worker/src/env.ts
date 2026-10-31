import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  MODE: z.enum(['naive', 'fairqueue']).default('fairqueue'),
  // How often the admission/expiry loop runs.
  TICK_MS: z.coerce.number().default(1000),
  // Touched after every completed tick; the Kubernetes liveness probe reads it.
  HEARTBEAT_FILE: z.string().default('/tmp/worker-heartbeat'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

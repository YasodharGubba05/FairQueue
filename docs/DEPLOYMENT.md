# Deployment

FairQueue is three processes and two datastores. This describes how they are
wired for a public deployment, and — just as importantly — the two decisions
that are not obvious.

## Topology

| Component | Host | Notes |
|---|---|---|
| `web` | Vercel | Static build, plus a rewrite that proxies `/api/*` to the API |
| `api` | Render Web Service | Stateless; may run more than one instance |
| `worker` | Render Background Worker | **Exactly one instance, always** |
| PostgreSQL | Neon | |
| Redis | Upstash | `rediss://` — ioredis enables TLS from the scheme |

## Why the API is proxied through Vercel rather than called directly

The refresh token lives in an `HttpOnly` cookie. If the browser talks to
`fairqueue.vercel.app` and the API lives on `fairqueue-api.onrender.com`, those
are different sites, and a `SameSite=Lax` cookie is **not sent** on cross-site
requests — so session restore silently fails and every reload signs the user
out.

There are two ways out. Relax the cookie to `SameSite=None; Secure`, which
works but gives up the CSRF protection `Lax` was providing. Or put both behind
one origin, which is what the Vercel rewrite does: the browser only ever talks
to its own origin, the cookie keeps `SameSite=Lax`, there is no CORS at all,
and the frontend needs no code change because it already uses relative paths.

The second is strictly better, so that is the arrangement.

## Why the WebSocket connects directly instead

Vercel's rewrites do not carry a WebSocket upgrade. So Socket.io connects
straight to the Render origin, which is cross-origin — and that is fine here,
because the socket does not rely on the cookie:

- Event rooms are public. What is on sale is not a secret.
- The per-user notification room is joined by presenting the access token
  explicitly over the socket, which works regardless of cookie policy.

`VITE_SOCKET_URL` points the client at the API origin. Left unset, it connects
to its own origin, which is what local development wants.

## Environment variables

Set in the hosting dashboards, never in the repository.

### Render — `api`

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `REDIS_URL` | Upstash `rediss://` URL |
| `JWT_SECRET` | 32+ random bytes, unique to production |
| `MODE` | `fairqueue` |
| `WEB_ORIGIN` | The Vercel URL |
| `COOKIE_SECURE` | `true` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://<vercel-url>/api/auth/google/callback` |
| `TICKETMASTER_API_KEY` | Optional; without it the seeded catalogue is used |
| `EVENT_SYNC_INTERVAL_MINUTES` | `360`, or `0` to disable |
| `NODE_ENV` | `production` |

`POD_NAME` should be set to Render's instance id so Mission Control can count
instances; `API_PORT` is supplied by Render as `PORT`.

### Render — `worker`

`DATABASE_URL`, `REDIS_URL`, `MODE=fairqueue`, `NODE_ENV=production`.
Nothing else: the worker has no HTTP surface and no credentials of its own.

### Vercel — `web`

`VITE_SOCKET_URL` = the Render API origin. The rewrite in `vercel.json`
must also have its placeholder host replaced with that origin.

## Migrations

`npx prisma migrate deploy` as the API's pre-deploy command. Never
`migrate dev`, which is interactive and will rewrite history.

Seeding is deliberately not automatic: `npm run seed` **deletes every event,
user and order** before inserting demo data. It is run by hand, once, and never
again against a database anybody is using.

## The worker and its schema

`worker/prisma/schema.prisma` is a symlink to the API's copy, so the two can
never drift. A Render service rooted at `worker/` cannot follow that symlink
out of its root, so the worker's build runs from the repository root instead:

```
Build:  npm --prefix worker ci && npm --prefix worker run build
Start:  node worker/dist/index.js
```

## Known limitations

- **One worker, deliberately.** It is the only process allowed to move the
  queue forward; a second would hand out the same admission passes twice.
  Render's Background Worker must stay at one instance.
- **Free-tier Render spins down when idle.** The first request after a quiet
  period waits for a cold start, and while the worker is asleep the queue does
  not advance. Acceptable for a demonstration; not for a sale.
- **Upstash free tier has a command budget.** The worker ticks once a second
  and touches Redis several times per tick, so a permanently running worker
  will consume it. Raising `TICK_MS` reduces the rate.
- **Kubernetes autoscaling remains unverified** — see `k8s/README.md`. The
  manifests are not used by this deployment.
- **Payments and tickets are simulated.** Nothing is charged and no ticket
  admits anybody to any event, whatever the event's details say.

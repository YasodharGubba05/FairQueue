# FairQueue

A flash-sale ticketing site that does not crash, never sells a seat twice, serves
buyers in the order they arrived, and keeps bots out of the line.

The full README (architecture diagram, before/after benchmark table, design
decisions, screenshots) is written in phase P7.

## Run it locally

Without Docker, using Homebrew services:

```bash
cp .env.example .env
make install
make services-up      # postgres + redis
make db-create
make migrate
make seed
```

Then, in three terminals: `make dev-api`, `make dev-worker`, `make dev-web`,
and open http://localhost:5173.

With Docker instead:

```bash
cp .env.example .env
make compose-up
open http://localhost:5173
```

### Seeded logins

| Account | Password |
|---------|----------|
| `admin@fairqueue.dev` | `admin123` |
| `buyer0001@fairqueue.dev` … `buyer2000@fairqueue.dev` | `password123` |

Three events are seeded. `evt_headline` is the 2,000 seat venue the benchmarks
run against; its sale is already open.

## Layout

| Path      | What it is |
|-----------|------------|
| `web/`    | React + Vite frontend |
| `api/`    | Stateless Express API + Socket.io |
| `worker/` | The one process that admits users from the queue and expires seat holds |
| `k8s/`    | Plain Kubernetes manifests + HPA |
| `bench/`  | k6 load tests and the before/after comparison script |

## Modes

`MODE=naive` is the deliberately broken "before" build: no queue, no locks, a
plain read-then-write checkout. `MODE=fairqueue` is the real thing. The
benchmarks run both and compare them.

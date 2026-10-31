# Kubernetes

Plain YAML, applied in filename order. No Helm: every object here is a file you
can read top to bottom.

| File | What it is |
|------|------------|
| `00-namespace.yaml` | Everything lives in `fairqueue`, so deleting the namespace is a full uninstall |
| `10-config.yaml` | Shared settings, split into a ConfigMap and a Secret by sensitivity |
| `20-postgres.yaml` | The permanent record, with a PVC and a `Recreate` strategy |
| `21-redis.yaml` | Live sale state. Persistence off on purpose — all of it is rebuildable |
| `30-api.yaml` | The stateless api, its Service, and the HPA that owns its replica count |
| `31-worker.yaml` | Exactly one worker. The one component that deliberately does not scale |
| `32-web.yaml` | nginx serving the built frontend and proxying `/api` and the websocket |
| `40-migrate-job.yaml` | Schema and seed, as a Job rather than an init container |

```bash
make up          # cluster, images, deploy       -> http://localhost:8080
make status      # pods and the HPA
make watch-hpa   # the autoscaler deciding, live
make scale-test  # load, then measure the scale out and back in
make down        # delete the cluster
```

## Verification status

**The manifests in this directory have not yet been run against a live
cluster.** They were written and reviewed, and checked offline: every document
parses, every container declares liveness and readiness probes plus CPU and
memory requests and limits, and the worker's heartbeat probe was exercised
directly — passing against a live heartbeat and exiting 1 against a stale one.

What has *not* been confirmed is the part that needs a cluster: that the images
build and start, that the migrate Job completes before the api rolls out, and
that the HPA actually scales the api out under load and back in afterwards.

Running it needs a container runtime, which the development machine did not
have. To finish the verification:

```bash
brew install colima docker kubectl k3d
colima start --cpu 4 --memory 8
make up
make scale-test
```

Until that has been done, `RESULTS.md` carries no autoscaling numbers and the
README makes no claim about them. Nothing in this project's results is written
by hand; the scale-test numbers will come from `bench/results/scale-test.json`
or they will not appear at all.

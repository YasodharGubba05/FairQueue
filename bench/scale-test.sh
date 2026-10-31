#!/usr/bin/env bash
# Proves the api scales out under load and comes back down afterwards.
#
# Drives the real sale path through the cluster with k6, sampling the replica
# count and CPU the whole time, and writes what it saw to
# bench/results/scale-test.json. Nothing in RESULTS.md is typed by hand — it
# comes from this file.
set -euo pipefail

NS=fairqueue
OUT_DIR="$(cd "$(dirname "$0")" && pwd)/results"
OUT="$OUT_DIR/scale-test.json"
SAMPLES="$OUT_DIR/.scale-samples"
API_URL="${API_URL:-http://localhost:8080}"

mkdir -p "$OUT_DIR"
: > "$SAMPLES"

echo "==> baseline"
kubectl -n "$NS" get hpa api
BASELINE=$(kubectl -n "$NS" get deploy api -o jsonpath='{.status.readyReplicas}')
echo "    api replicas at rest: ${BASELINE:-0}"

# Sample the replica count every 5s in the background, so the scale-up is
# recorded as it happens rather than guessed at afterwards.
sample() {
  while true; do
    local now ready cpu
    now=$(date +%s)
    ready=$(kubectl -n "$NS" get deploy api -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo 0)
    cpu=$(kubectl -n "$NS" get hpa api -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}' 2>/dev/null || echo 0)
    echo "{\"at\":$now,\"replicas\":${ready:-0},\"cpuPercent\":${cpu:-0}}" >> "$SAMPLES"
    sleep 5
  done
}
sample & SAMPLER=$!
# Always stop the sampler, however this script exits.
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

echo "==> load (k6)"
START=$(date +%s)
API_URL="$API_URL" k6 run --quiet "$(dirname "$0")/flash-sale.js" || true
LOAD_END=$(date +%s)

echo "==> cooling down, watching it scale back in"
# The HPA's scaleDown stabilization window is 60s, so give it enough quiet time
# to act plus a margin.
sleep 150
END=$(date +%s)

kill $SAMPLER 2>/dev/null || true

python3 - "$SAMPLES" "$OUT" "$START" "$LOAD_END" "$END" "${BASELINE:-0}" <<'PY'
import json, sys

samples_path, out_path, start, load_end, end, baseline = sys.argv[1:7]
start, load_end, end, baseline = int(start), int(load_end), int(end), int(baseline)

samples = []
with open(samples_path) as fh:
    for line in fh:
        line = line.strip()
        if line:
            try: samples.append(json.loads(line))
            except json.JSONDecodeError: pass

during = [s for s in samples if start <= s['at'] <= load_end]
after = [s for s in samples if s['at'] > load_end]

result = {
    "test": "scale-test",
    "mode": "fairqueue",
    "load_seconds": load_end - start,
    "cooldown_seconds": end - load_end,
    "replicas_at_rest": baseline,
    "replicas_peak": max((s['replicas'] for s in samples), default=0),
    "replicas_after_cooldown": after[-1]['replicas'] if after else None,
    "cpu_percent_peak": max((s['cpuPercent'] for s in samples), default=0),
    "scaled_up": max((s['replicas'] for s in during), default=0) > baseline,
    "scaled_back_down": bool(after) and after[-1]['replicas'] < max((s['replicas'] for s in samples), default=0),
    "samples": samples,
}

with open(out_path, 'w') as fh:
    json.dump(result, fh, indent=2)

print()
print(f"  replicas at rest        {result['replicas_at_rest']}")
print(f"  replicas at peak        {result['replicas_peak']}")
print(f"  replicas after cooldown {result['replicas_after_cooldown']}")
print(f"  peak CPU vs request     {result['cpu_percent_peak']}%")
print(f"  scaled up               {result['scaled_up']}")
print(f"  scaled back down        {result['scaled_back_down']}")
print()
print(f"  written to {out_path}")
PY

rm -f "$SAMPLES"

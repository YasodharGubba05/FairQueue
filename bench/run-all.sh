#!/usr/bin/env bash
# Every scenario against both builds, then the comparison table.
#
# Order matters: for each scenario the naive run goes first and the fairqueue
# run second, so the database is left in a correct state rather than full of
# the duplicates naive mode deliberately creates.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCENARIOS=("${BENCH_SCENARIOS:-hot-seats flash-sale bots breaking-point}")
read -ra SCENARIOS <<< "${SCENARIOS[0]}"

failed=0
for scenario in "${SCENARIOS[@]}"; do
  for mode in naive fairqueue; do
    echo
    echo "────────────────────────────────────────────────────────"
    if ! npx --prefix api tsx bench/run.ts "$scenario" "$mode"; then
      echo "  !! $scenario / $mode did not complete"
      failed=$((failed + 1))
    fi
    # Let the machine settle so one run's tail does not land in the next one's
    # measurement window.
    sleep 3
  done
done

echo
echo "────────────────────────────────────────────────────────"
echo "  generating RESULTS.md"
npx --prefix api tsx bench/compare.ts

if [ "$failed" -gt 0 ]; then
  echo
  echo "  $failed run(s) did not complete — RESULTS.md covers only what did"
fi

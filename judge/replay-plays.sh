#!/usr/bin/env bash
# Replay both captured Rote Plays with fresh inputs and check the expected results. Local only.
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"
ROTE="${TRU_ROTE:-rote}"; OUT="$TRU_PLAN_OUTPUT/replays"; mkdir -p "$OUT"; fail=0
check() { if [ "$2" = "$3" ]; then echo "  PASS $1 = $2"; else echo "  FAIL $1: expected $3, got $2"; fail=1; fi; }
echo "== order-review Play: 100 / 140 / 150 shirts at \$1,800 =="
for q in 100 140 150; do
  "$ROTE" play run plays/order-review/main.ts "procedure=$PWD/procedures/order-review.ts" "input=$PWD/fixtures/plays/review-input.json" "quantity=$q" "budgetCents=180000" "output=$OUT/review-$q.json" >"$OUT/review-$q.log" 2>&1 || { echo "  FAIL rote run for $q (see $OUT/review-$q.log)"; fail=1; continue; }
  grep -m1 run_id "$OUT/review-$q.log" | sed 's/^/  /'
  total=$(python3 -c "import json;d=json.load(open('$OUT/review-$q.json'));print(d['proposal']['chosen']['totalCents'] if d['proposal']['chosen'] else 'none')")
  case $q in 100) check "total for 100" "$total" 115000;; 140) check "total for 140" "$total" 163000;; 150) check "total for 150" "$total" 175000;; esac
done
echo "== order-review Play with the company rule 'never split shipments' =="
"$ROTE" play run plays/order-review/main.ts "procedure=$PWD/procedures/order-review.ts" "input=$PWD/fixtures/plays/review-input-never-split.json" "quantity=150" "budgetCents=180000" "output=$OUT/review-150-never-split.json" >"$OUT/review-150-never-split.log" 2>&1 || { echo "  FAIL rote run"; fail=1; }
chosen=$(python3 -c "import json;d=json.load(open('$OUT/review-150-never-split.json'));print(d['proposal']['chosen'])" 2>/dev/null)
check "no feasible option when split is forbidden at \$1,800" "$chosen" None
echo "== work-packet Play: approved 140-shirt proposal =="
"$ROTE" play run plays/work-packet/main.ts "procedure=$PWD/procedures/work-packet.ts" "input=$PWD/fixtures/plays/approved-140.json" "output=$OUT/packet-140.md" >"$OUT/packet-140.log" 2>&1 && grep -q "140 black T-shirts" "$OUT/packet-140.md" && echo "  PASS packet written: $OUT/packet-140.md" || { echo "  FAIL packet"; fail=1; }
grep -m1 run_id "$OUT/packet-140.log" | sed 's/^/  /'
echo "== work-packet Play must refuse a stale approval (approved 150, proposal now 140) =="
if "$ROTE" play run plays/work-packet/main.ts "procedure=$PWD/procedures/work-packet.ts" "input=$PWD/fixtures/plays/stale-approval.json" "output=$OUT/packet-stale.md" >"$OUT/packet-stale.log" 2>&1; then echo "  FAIL stale approval was accepted"; fail=1; else echo "  PASS stale approval refused"; fi
[ $fail -eq 0 ] && echo "All Play replays passed." || { echo "Some Play replays failed."; exit 1; }

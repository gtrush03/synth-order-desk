#!/usr/bin/env bash
# Isolated self-check of this export: dependencies, TypeScript, build, tests, Play replays, voice fixture, on-device helper, server smoke.
# Build/runtime outputs write under $TRU_PLAN_OUTPUT (default ./run); dependencies install in this checkout. Existing published receipts stay unchanged. No conversation turn or sponsor call.
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"; export TRU_SOURCE="$PWD"
status=0; step() { echo; echo "### $1"; }
step "bun install (pinned TypeScript, RocketRide, Tenki SDK and guest Playwright)"; if [ -f bun.lock ]; then bun install --frozen-lockfile || status=1; else bun install || status=1; fi
if [ -f event-workspace/package.json ]; then step "event dependencies (pinned, isolated)"; (cd event-workspace && if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi) || status=1; fi
step "python venv + neo4j driver (requirements.lock)"; if command -v uv >/dev/null 2>&1; then uv venv .venv --python 3.13 && uv pip install --python .venv/bin/python pip -r requirements.lock || status=1; else python3 -m venv .venv && .venv/bin/pip install -r requirements.lock || status=1; fi
.venv/bin/python -c "import neo4j,edge_tts; print('neo4j driver', neo4j.__version__); print('edge-tts import available; no speech request made')" || status=1
step "typescript check"; bun run check || status=1
step "build (Swift helper + bundles)"; bun run build || status=1
step "tests"; bun run test || status=1
if [ -f scripts/rocketride-cloud.test.ts ]; then step "rocketride adapter tests (fake clients, no network)"; NODE_ENV=test bun test scripts/rocketride-cloud.test.ts || status=1; fi
if [ -f event-workspace/package.json ]; then step "event SQLite and boundary tests (fake senders)"; mkdir -p "$TRU_PLAN_OUTPUT/self-check"; bun test event-workspace/tests > "$TRU_PLAN_OUTPUT/self-check/event-tests.txt" 2>&1 || status=1; cat "$TRU_PLAN_OUTPUT/self-check/event-tests.txt"; step "event worker TypeScript"; (cd event-workspace && bun run check) || status=1; step "event Bun runtime bundle"; bun build event-workspace/runtime/bun-server.ts --target=bun --outfile="$TRU_PLAN_OUTPUT/event-server.js" || status=1; fi
step "rote play replays"; bash judge/replay-plays.sh || status=1
step "voice fixture transcription"; bash judge/voice-check.sh || status=1
step "on-device model helper"; bash judge/model-check.sh || status=1
step "server smoke (read-only)"; bun run judge/smoke.ts || status=1
echo; [ $status -eq 0 ] && echo "SELF-CHECK PASSED" || echo "SELF-CHECK HAD FAILURES"; exit $status

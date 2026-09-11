#!/usr/bin/env bash
# Start the exported talking order desk on 127.0.0.1 only.
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"
export TRU_SOURCE="${TRU_SOURCE:-$PWD}"
export TRU_PLAN_PORT="${TRU_PLAN_PORT:-7790}"
[ -f "$TRU_PLAN_OUTPUT/dist/server.js" ] || { echo "Build first: bun run build"; exit 1; }
echo "Opening http://127.0.0.1:$TRU_PLAN_PORT/talk  (Ctrl-C stops the server)"
exec node "$TRU_PLAN_OUTPUT/dist/server.js"

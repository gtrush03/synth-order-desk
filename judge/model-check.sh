#!/usr/bin/env bash
# Ask the compiled Apple on-device helper to classify one sentence. Requires macOS 26 with Apple Intelligence.
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"
BIN="${TRU_LOCAL_MODEL:-$TRU_PLAN_OUTPUT/bin/synth-local-model}"
[ -x "$BIN" ] || { echo "Build first (bun run build); helper missing at $BIN"; exit 1; }
printf '%s' '{"mode":"interpret","prompt":"{\"latestUserMessage\":\"Actually, make it 140 shirts.\"}"}' | "$BIN"

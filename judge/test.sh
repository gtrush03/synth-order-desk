#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"
bun run check && bun run test

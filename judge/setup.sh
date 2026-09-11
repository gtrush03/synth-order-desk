#!/usr/bin/env bash
# Judge setup for TRU Synth Order Desk. Local only; installs nothing globally.
set -u
cd "$(dirname "$0")/.."
echo "== Required tools (pinned versions in docs/PLATFORM.md) =="
for tool in bun node rote deno whisper-cli ffmpeg python3 uv xcrun docker snyk; do
  if command -v "$tool" >/dev/null 2>&1; then printf "  %-12s %s\n" "$tool" "$(command -v "$tool")"; else printf "  %-12s MISSING\n" "$tool"; fi
done
echo "  bun $(bun --version 2>/dev/null)  node $(node --version 2>/dev/null)  rote $(rote --version 2>/dev/null | head -1)"
echo "== JavaScript dev dependencies (typescript, @types/node) =="
if [ -f bun.lock ]; then bun install --frozen-lockfile || { echo "bun install --frozen-lockfile failed"; exit 1; }; else bun install || { echo "bun install failed"; exit 1; }; fi
echo "== Python virtual environment for the HydraDB bridge =="
if command -v uv >/dev/null 2>&1; then uv venv .venv --python 3.13 >/dev/null && uv pip install --python .venv/bin/python pip -r requirements.lock; else python3 -m venv .venv && .venv/bin/pip install -r requirements.lock; fi
echo "== Whisper models =="
mkdir -p models
for m in ggml-large-v3-turbo-q5_0.bin ggml-silero-v6.2.0.bin; do if [ -f "models/$m" ]; then echo "  models/$m present ($(stat -f %z "models/$m") bytes)"; else echo "  models/$m MISSING — see models/README.md"; fi; done
echo "== Rote SDK =="
if [ -f "$HOME/.rote/lib/sdk/ts/presentation.ts" ]; then echo "  rote TypeScript SDK installed"; else echo "  run: rote sdk install"; fi
echo "== Environment =="
[ -f judge.env ] || cp judge.env.example judge.env
echo "  edit judge.env, then: set -a; source judge.env; set +a"
echo "== Build =="
bun run build && echo "Setup complete. Next: judge/test.sh, judge/replay-plays.sh, judge/start.sh"

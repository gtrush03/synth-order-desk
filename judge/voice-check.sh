#!/usr/bin/env bash
# Transcribe the synthetic voice-note fixture locally, without the server. Proves the voice path.
set -u
cd "$(dirname "$0")/.."
export TRU_PLAN_OUTPUT="${TRU_PLAN_OUTPUT:-$PWD/run}"
FF="${TRU_FFMPEG:-ffmpeg}"; WC="${TRU_WHISPER_CLI:-whisper-cli}"; MODEL="${TRU_WHISPER_MODEL:-$PWD/models/ggml-large-v3-turbo-q5_0.bin}"; VAD="${TRU_WHISPER_VAD:-$PWD/models/ggml-silero-v6.2.0.bin}"
mkdir -p "$TRU_PLAN_OUTPUT/voice-check"
"$FF" -hide_banner -nostdin -v error -i fixtures/voice/customer-150.m4a -t 30 -vn -ac 1 -ar 16000 -c:a pcm_s16le -y "$TRU_PLAN_OUTPUT/voice-check/decoded.wav" || exit 1
"$WC" -m "$MODEL" -f "$TRU_PLAN_OUTPUT/voice-check/decoded.wav" -l en -t 4 -mc 0 --vad -vm "$VAD" -vp 250 -oj -of "$TRU_PLAN_OUTPUT/voice-check/transcript" >/dev/null 2>&1 || exit 1
python3 -c "import json;print('Transcript:',' '.join(s['text'] for s in json.load(open('$TRU_PLAN_OUTPUT/voice-check/transcript.json'))['transcription']).strip())"

# Platform requirements and browser voice

## Pinned tool versions (as used on the source machine)

| Tool | Version |
|---|---|
| macOS | 26.5.2 (Apple Intelligence enabled; FoundationModels framework) |
| Xcode | 26.5 command-line tools (xcrun swiftc, Swift 6.3.2) |
| bun | 1.3.10 |
| node | 22.22.0 |
| typescript | 5.9.3 |
| @types/node | 26.1.2 |
| edge-tts | 7.2.8 (Microsoft Ava reply speech; no reasoning authority) |
| python | 3.13.12 |
| neo4j (python driver) | 6.3.0 |
| uv | 0.10.7 |
| whisper.cpp | 1.9.2 (whisper-cli; ggml 0.20.1) |
| whisper model | ggml-large-v3-turbo-q5_0.bin (574,041,195 bytes) + ggml-silero-v6.2.0.bin (885,098 bytes) |
| ffmpeg | 9.0.1 |
| rote | 0.82.0 (+ rote sdk install) |
| deno (used by rote) | 2.8.3 |
| Cognee | 1.5.4 local API on 127.0.0.1:8765 |
| HydraDB | ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709 (label v0.1.1; Bolt 7687) |
| Docker | 29.4.3 |
| snyk CLI | 1.1307.1 |
| Tenki SDK | @tenkicloud/sandbox 1.0.6 (optional host control of an existing VM) |
| Playwright | 1.56.0 (distribution; recorded guest originally 1.55.0) |

## Browser microphone
The live voice loop uses `navigator.mediaDevices.getUserMedia` and `MediaRecorder` on `http://127.0.0.1`, which browsers treat as a secure context, so no HTTPS certificate is needed. Verified on the source Mac with Safari-family and Chromium-family browsers on macOS 26 (WebM/Opus or MP4 recording). Grant the microphone permission when the browser asks; the microphone stays off until "Start talking" is pressed and is released after each utterance. Spoken replies use the Web Speech API with a local English system voice (Samantha, Eddy or Daniel); if none is installed, replies are shown but not spoken. iOS Safari and remote (non-localhost) hosts were not tested. The physical EarPods microphone and spoken replies were confirmed by the owner on the source Mac (`evidence/physical-voice-check.json`).

## Services
- **Cognee 1.5.4** local API on `127.0.0.1:8765` (any dataset name works; the app creates `hackathon-orderdesk-20260911`).
- **HydraDB** container, pinned by digest, bound to loopback, with its own volume (do not reuse another HydraDB's data directory): `docker run -d --name hydradb-orderdesk -p 127.0.0.1:7687:7687 -p 127.0.0.1:9090:9090 -v hydradb-orderdesk:/data ghcr.io/hydra-db/hydradb@sha256:db78309a233be54662db29744047e985a39b51c45a270d1a1f47c31a62cdb709` (image label v0.1.1, AGPL-3.0). Set `HYDRADB_URI=bolt://127.0.0.1:7687` and any credentials in `judge.env`. If you already run HydraDB, point the URI at it instead and do not recreate that container.
- **Rote 0.82.0** with `rote sdk install` (the Plays import the SDK from `$HOME/.rote/lib/sdk/ts`, and Rote writes the import map on first run).
- **Hotdata** optional: your own API key and workspace; enable the allowance file only if you accept bounded storage/read charges against your own credit.

## Models
Place `ggml-large-v3-turbo-q5_0.bin` and `ggml-silero-v6.2.0.bin` in `models/` (see `models/README.md`) or point `TRU_WHISPER_MODEL` and `TRU_WHISPER_VAD` at existing copies.

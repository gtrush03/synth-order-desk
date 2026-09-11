# Attribution and licences

Submission code (`src/`, `native/`, `procedures/`, `plays/`, `tests/`, `judge/`, `docs/`): © 2026 TRU Synth. See `LICENSE.md`.

Third-party components used at runtime (not vendored, installed by the operator):

| Component | Version | Licence | Use |
|---|---|---|---|
| Apple FoundationModels framework | macOS 26 | Apple SDK terms | on-device intent extraction and short replies |
| whisper.cpp / whisper-cli | 1.9.2 | MIT | local transcription |
| ggml | 0.20.1 | MIT | whisper backend |
| Whisper large-v3-turbo (ggml q5_0) and Silero VAD (ggml) models | — | MIT (OpenAI Whisper weights, MIT); Silero VAD, MIT | speech models, downloaded by the operator |
| ffmpeg | 9.0.1 | GPL-3.0-or-later (Homebrew build) | audio decoding, invoked as a separate process |
| Bun | 1.3.10 | MIT | bundling, tests, procedure execution |
| Node.js | 22.22.0 | MIT | server runtime |
| TypeScript, @types/node | 5.9.3, 26.1.2 | Apache-2.0, MIT | type check only |
| edge-tts | 7.2.8 | LGPLv3 (installed package metadata) | optional Microsoft Ava speech for confirmed replies; separate from reasoning |
| neo4j Python driver | 6.3.0 | Apache-2.0 | HydraDB Bolt bridge |
| HydraDB container image | v0.1.1 | AGPL-3.0 (image label) | local graph database |
| Cognee | 1.5.4 | Apache-2.0 | local memory API |
| Rote CLI and TypeScript SDK | 0.82.0 | Modiqo terms (installed by the operator via `rote sdk install`) | captured Plays |
| Hotdata | API | provider terms | opt-in scoped SQL |
| Tenki SDK (`@tenkicloud/sandbox` on npm) | 1.0.6 | MIT | host-only controller; existing explicitly allowed session only |
| Playwright | 1.56.0 | Apache-2.0 | patched distribution dependency; original recorded guest used 1.55.0; no local browser launched by tests |
| RocketRide SDK (`rocketride` on npm) | 1.3.0 | MIT | integrated deterministic cloud cross-check; credentials only from the environment or `judge.env` |
| Snyk CLI | 1.1307.1 | provider terms | scanning |

The TRU Synth wordmark is the company's trademark and is included only for this submission's UI. Sponsor marks under `public/sponsors/` (when present) are the sponsors' trademarks, supplied for this hackathon and used only to label each sponsor's role; their sources are recorded in `evidence/sponsor-logo-sources.json`.

# Architecture

```
browser /talk (src/talk.ts)                     Mac (127.0.0.1 only)
  ├─ MediaRecorder ─► POST /api/voice/transcribe ─► ffmpeg ─► whisper-cli (local) ─► text
  └─ POST /api/conversation/turn ─► src/local-conversation.ts
        1. interpret  ──► bin/synth-local-model (Apple FoundationModels, structured Intent)
        2. facts      ──► src/data-workers.ts ──► Hotdata: 3 scoped DBs, concurrent SQL, probe, delete   (or local file)
        3. quote      ──► src/conversation-model.ts (standard / express / split; policy; approval rules)
        4. constraints──► native/hydra_order.py ──► HydraDB (order → deadline, order → policy)
        5. procedure  ──► rote play run plays/order-review  ──► procedures/order-review.ts  (must equal step 3)
        5b. cloud     ──► src/rocketride-cloud.ts ──► RocketRide staging tool_python sandbox (opt-in allowance; verdict must agree; fingerprint gates approval)
        6. reply      ──► deterministic, or bin/synth-local-model (chat only)
        7. deliverable──► rote play run plays/work-packet ──► procedures/work-packet.ts (approved only)
        8. memory     ──► run/conversation/company/memory.json ──► Cognee dataset (raw document per revision)
  ◄─ JSON state (messages, events with IDs and timings, artifacts) ─► browser plays the confirmed reply (Microsoft Ava speech)
```

Trust boundaries: the server accepts only Host 127.0.0.1/localhost, requires the exact local Origin on mutations, caps JSON bodies at 25 KB and audio at 4 MB / 30 s, applies a strict Content-Security-Policy (media-src self and blob only on /talk), and serves only allowlisted files and documents. Child processes (model helper, ffmpeg, whisper-cli, python bridge, rote) run with bounded timeouts and output sizes. Audio is deleted after transcription. Enabled review calls reach Hotdata and RocketRide; constraints and memory use local HydraDB and Cognee. Unmuted reply synthesis reaches Microsoft's Ava service. Explicitly enabled actions also reach Tenki, Gmail, GitHub and Printful. Each action's configured destination and approval boundary is documented separately.

State layout under `TRU_PLAN_OUTPUT` (default `./run`): `bin/` compiled helper, `dist/` server bundle, `public/` client, `conversation/company/{data.json,memory.json}`, `conversation/sessions/*.json`, `conversation/drafts/*.md`, `conversation/receipts/*.json`, `conversation/procedures/<id>/{input.json,output.*,receipt.json}`, `conversation/hotdata-allowance.json` (opt-in), `conversation/hotdata-run-count.json`, `conversation/verified-data.json` (5-minute Hotdata snapshot cache).

Decision rules worth reading in `src/conversation-model.ts`: quantity 1–200; budget $0–$10,000; a budget is accepted only when the utterance mentions money; approval needs an explicit phrase without a negation and applies only to the currently reviewed proposal; any quantity, budget, policy-note or source-data change clears approval; the company rule "never split shipments" removes the split option until a later "allow split" note; the newest matching note wins.

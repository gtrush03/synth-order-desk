# Demo script (three-minute rehearsal target)

See `docs/FULL-WALKTHROUGH.md` section 5 for the timed table. Preconditions: server built and started; HydraDB and Cognee running; company memory reset in both the local file and the Cognee dataset; Hotdata allowance either enabled with runs remaining or absent (local-file mode is labelled in the receipts).

Expected numbers with `fixtures/company.json`: 150 shirts at $1,800 → split $1,750 (standard $1,650 late; express $1,950 over budget). 140 shirts → split $1,630. 150 shirts at $2,000 with "never split shipments" → express $1,950. 100 shirts → $1,150.

Fallbacks: the typed starter buttons on /talk; the voice-note fixture `fixtures/voice/customer-150.m4a` through the paper-clip button; `judge/replay-plays.sh` for the Plays without the UI.

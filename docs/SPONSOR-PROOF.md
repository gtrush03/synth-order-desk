# Sponsor proof — code path, receipt, what you can verify

Receipts come from live runs on the source Mac on September 11, 2026 (Pacific times). Paths in receipts are sanitized (`<run>`, `<control-room>`).

## Hotdata
- Code: `src/data-workers.ts` (`runDataWorkers`), `src/hotdata-http.ts` (documented REST API over HTTPS/IPv4, bearer auth, 12 s request bound, 512 KB response bound).
- Per review: `POST /v1/databases` ×3 (inventory, rates, rules; 30-minute expiry; `if_not_exists`), inline CSV `loads`, three concurrent `POST /v1/query` (`dialect: duckdb`), an isolation probe (inventory DB selecting from the shipping catalog must fail with table-not-found), `DELETE` ×3. Results are validated strictly (column/row counts) and the SQL-returned facts replace the file facts.
- Receipt: `evidence/hotdata-order-proof.json` — three database IDs, three `query_run_id`s, returned rows, `isolationProbe.denied: true` (HTTP 400), `destroyed: true` ×3, `queryOverlapMs: 1619`. `evidence/hotdata-cleanup-reconciliation.json` — two leftovers from earlier network failures deleted; remaining `[]`.
- Verify yourself: with your own key and an enabled allowance, run one review and open the data-source receipt link in "See what happened".
- Not claimed: overlap is not a speedup; scoping is database/table scoping under one credential; expiry is best effort.

## HydraDB
- Code: `native/hydra_order.py` (neo4j Python driver over Bolt), called from `src/local-procedures.ts` `graphConstraints` with a 10 s bound.
- Per review: MERGE order, deadline and policy nodes; CREATE `orderdesk_requires` edges; MATCH returns exactly two constraints; the returned deadline and policy are what the review Play receives. Missing constraints stop the turn (HTTP 503).
- Receipt: `evidence/integrated-review.json` (order node, 2 rows, 32 ms) and `evidence/full-flow-verification.json` (30 ms).

## Cognee
- Code: `src/cognee-memory.ts` — `POST /api/v1/add` with a raw text document, labels and external metadata (revision); recall via `GET /api/v1/datasets`, `/data`, `/raw`; strict validation of the retrieved memory.
- Receipt: `evidence/full-flow-verification.json` — a fresh conversation shows "Retrieved company instructions from Cognee" (revision 2) and chooses express because split is forbidden; later saves record revisions 3 and 4.
- Not claimed: no cognify, embeddings, graph completion or LLM call.

## Rote
- Code: `plays/order-review/main.ts`, `plays/work-packet/main.ts` (Rote 0.82.0 `process.exec` steps), `procedures/*.ts` (what the steps run), `src/local-procedures.ts` (invocation per turn; the server refuses to proceed if the Play's proposal differs from its own).
- Receipt: `evidence/rote-plays-proof.json` — both Plays at 100, 140 and 150 shirts with run IDs; stale approval refused. `plays/*/.rote-flow-lint.json` — static and runtime lint pass (one informational fixture notice).
- Verify yourself: `judge/replay-plays.sh` replays both Plays with the shipped fixtures and checks the totals and the stale-approval refusal.
- Not claimed: no time or cost saving is measured against an exploratory run; Plays are draft/unpublished.

## RocketRide
- Code: `src/rocketride-cloud.ts` (`cloudReviewCrossCheck`: builds and validates the pipeline, sends the deterministic order-review program to the `tool_python` node through the `tools` source, terminates the task, reads the credit balance before and after, compares the returned proposal with the local one; refuses to run below a credit floor or without an enabled allowance), `src/approval-proof.ts` (fingerprint of facts + proposal that a cloud review is valid for), `src/local-conversation.ts` (disagreement pauses approval; approval and drafting need a current cloud review while the allowance is enabled).
- Receipts: `evidence/rocketride-cloud-proof.json` — 12:40 PM, pipeline validated, three cases (150 → split, 140 → split, 150 with never-split → none) agree with the local reference, 11.4 s, task terminated, 0.5 credit units; `evidence/rocketride-cloud-ledger.json` — read-only ledger afterwards; `evidence/rocketride-staging-credits.json` — grant. Incident disclosed (`evidence/rocketride-cloud-ledger.json`): a timed-out early test started an unintended live task at 12:36 PM PT that consumed 20.6 credit units (ledger rows −19.7 and −0.9) before it was found and terminated at 12:38 PM; a failed extractor attempt cost 0.3 units; the successful proof cost 0.5 units; total 21.4 units, balance 4,819.9 of the 5,000-unit event grant, zero active tasks at 12:45:46 PM. Units are not dollars.
- Verify yourself: `NODE_ENV=test bun test scripts/rocketride-cloud.test.ts` runs 13 adapter tests with fake clients (no network). A real run needs your own staging key in `judge.env` and `run/conversation/rocketride-allowance.json` enabled.
- Live conversation receipt: `evidence/integrated-cloud-flow.json` when present (root's served integrated flow at 1:00:52 PM PT: 150 → $1,750 and 140 → $1,630 each cross-checked in the cloud, explicit approval, Rote packet with a matching approval revision, both cloud tasks terminated, approval saved to Cognee).
- Not claimed: agent fan-out or parallel waves; a measured speedup; any use of a language model in the cloud.

## Snyk
- See `docs/SECURITY.md` and `evidence/snyk/`.

## Not sponsors, but essential
- Apple FoundationModels (`native/LocalSynth.swift`): structured intent extraction and short spoken replies, greedy sampling, on device.
- whisper.cpp 1.9.2 with `large-v3-turbo-q5_0` and Silero VAD: local transcription. `evidence/talk-verification.json` records the verified voice note.

Extracted core tests (17); additional browser, work-ticket, workspace, Gmail, Tenki and GPT-Live suites are shipped under tests/. The event companion has its own tests/. Actual combined counts are in evidence/self-check/:
- sample decision respects budget and deadline and refuses an unfulfillable approval
- changing a sample preserves prior context but cannot reuse its approval for a new quantity
- a cloud-verified proposal cannot approve a changed order, policy, price or result
- conversation approval is explicit and amendments cannot inherit it
- preparing or publishing a changed order cannot silently use the old approval
- a saved packet belongs to its exact approval, even when a later order has the same quantity
- company instruction survives a fresh session and changes the next decision
- company data drives rates and strict Hotdata results reject partial facts
- another conversation changing policy or source invalidates both approval and draft eligibility
- the spoken explanation uses the actual company deadline
- a failed Hotdata create is reconciled and only this run databases are deleted
- repeating a prior instruction makes it current again after a contrary instruction
- newer retrieved Cognee memory restores an empty cache and cannot replace a later local revision
- only a contradictory recognized shipment rule can make an instruction historical
- live progress reflects actual pending work and an older run cannot overwrite a newer one
- live progress failure never turns unfinished work into success or exposes provider errors
- external actions preserve every potential quantity and budget amendment for exact approval checks

Tests of the private planning dashboard not shipped (7):
- a cached worker report cannot survive reboot or stale monitoring as a live process
- task completion and notes survive reopening, without changing the evidence baseline
- concurrent edits reject the stale writer instead of losing a saved update
- invalid edits and corrupted state preserve the original saved file
- local HTTP API enforces origin, revision, body and static-file boundaries
- live log parsing reports failures and fallback without treating zero recorded cost as complete pricing
- the plan has resolvable acyclic dependencies and does not force full account cutover before the bounded demo

Evidence files shipped:
- `evidence/build-plan.json`
- `evidence/full-flow-verification.json`
- `evidence/talk-verification.json`
- `evidence/hotdata-order-proof.json`
- `evidence/hotdata-cleanup-reconciliation.json`
- `evidence/integrated-review.json`
- `evidence/rote-plays-proof.json`
- `evidence/hotdata-credits.json`
- `evidence/rocketride-staging-credits.json`
- `evidence/cognee-cache-recovery.json`
- `evidence/submission-category.json`
- `evidence/physical-voice-check.json`
- `evidence/dataset-source.json`
- `evidence/launch-intent-check.json`
- `evidence/integrated-cloud-flow.json`
- `evidence/integration-checks.json`
- `evidence/failure-cleanup-check.json`
- `evidence/sponsor-logo-sources.json`
- `evidence/expanded-intent-check.json`
- `evidence/rocketride-cloud-ledger.json`
- `evidence/rocketride-cloud-profile.json`
- `evidence/rocketride-cloud-proof.json`
- `evidence/rocketride-cloud-receipt-f8c41f59-6ecb-44bb-8d12-354730a4671b.json`
- `evidence/rocketride-cloud-services.json`
- `evidence/security-code-enable.json`
- `evidence/security-code-findings.json`
- `evidence/security-code-scope.json`
- `evidence/security-code-triage.json`

# TRU Synth Order Desk

**Tell Synth what you need. Review the plan. Let it do the work.**

Voice requests. Real work. Clear approval. Built by George Trushevskiy for the September 11, 2026 Data & AI Hackathon.

## What you can do

Start with a practical request: “We need 150 black shirts by September 18, within $1,800.” Synth checks stock, delivery options and company rules, explains the feasible plan, and waits for explicit approval. Change the quantity to 140 and it recomputes the plan at $1,630. Once approved, it prepares the work packet and launch materials. A remembered shipping rule affects the next conversation.

The broader pattern is useful for team events, creator launches and recurring operations. This implementation covers merchandise planning with bounded actions and a labelled sample dataset. It does not claim to execute arbitrary business tasks.

The public playground lets anyone compare three sample projects, change quantity and budget, require one shipment, and inspect the stock rows and rates behind every result. It runs entirely in the browser, with no account or model call. The full conversational assistant runs on the demo Mac; the static site does not host Apple reasoning.

## Start here

- [Source and installation](https://github.com/gtrush03/synth-order-desk)
- [Public hub](https://trusynth-order-desk.pages.dev) — live static playground with the verified film, PDF, captions and transcript.
- [Approved public work ticket](https://github.com/gtrush03/synth-order-desk/issues/6)
- The hub provides the actual98-second video, English captions, transcript and seven-slide presentation. Canonical destinations are in `showcase-config.json`; an absent asset stays pending.
- [Temporary saved workspace](https://synth-order-work--23h39h.us.sb.tenki.sh) and [read-only cloud desktop](https://synth-live-desktop--23h39h.us.sb.tenki.sh/synth.html): September 11 until **4:51 PM PDT**, according to the current ROOT configuration. The recording and source remain available independently of the cloud computer.
- The separate event companion had a **3:15 PM PDT** consent and purge deadline. Extending the VM did not extend participant retention. Its expired link is removed from the hub.

## Current verified state

The latest isolated package passes **99 tests: 68 Node, 13 RocketRide adapter and 18 Event tests**. TypeScript, the native helper, web and Event runtime bundles, both Rote Plays, speech/model checks and an isolated server smoke also pass. The submitted application remains preserved at commit `8226a62`; later documentation, setup and media refinements are visible in Git history. The latest export was fully checked again after the setup and evidence-index refinements. `EXPORT-MANIFEST.json` records its file count and any subsequent documentation-only reuse of those checks. Exact test logs are in `evidence/self-check/self-check.txt`.

Fresh scans of that candidate found **zero vulnerabilities in 45 main npm dependencies and 15 Python dependencies**. The separate Event development dependency scan reports **29 findings** (3 critical, 15 high, 9 medium, 2 low); Snyk Code reports **16 open findings**, including a high path-traversal finding. These are disclosed with context in `SECURITY.md`, not suppressed. A separate local Cognee runtime also has a disclosed advisory; it is outside those clean dependency scopes. Passing tests does not mean the product is production ready.

Actual supplier acceptance now includes **Printful draft 176055721, quantity one, unsubmitted and unpaid**, verified again by provider GET. The requested artwork is not confirmed print-ready. This is a sample draft, not a purchase of the 140-shirt plan. The complete fresh capture **2026-09-11T22-29-20-832Z passed at 22:31:49 UTC**, with all **18 chapters**, **two fresh Hotdata waves** and no recorded errors. Its original screencast is 147.33 seconds before editing. It covers voice input, review, amendment, approval, packet, Tenki browsing, launch kit, work ticket, Printful draft readback, actual owner-email send, saved company policy, a fresh conversation, the changed decision, revised budget and security evidence.

In that same successful take, Printful draft 176055721 was reverified by provider GET at 22:30:58 UTC. The actual owner-email receipt records message **1a09298801c6dbe3**, sent at **22:31:04 UTC**; an independent owner-account readback showed both Sent and Inbox labels. This does not establish delivery to an external recipient. These receipts belong to the successful full take. Earlier failed recordings and Event self-test mail are separate historical evidence. Final edited media, captions and narration details are identified in the package's media proof and transcript.

Natural reply speech is implemented with Microsoft Ava through edge-tts 7.2.8 and confirmed by ROOT's speech endpoint and audio playback receipt. It speaks already-confirmed reply text. Apple FoundationModels handles local intent/reasoning. The optional GPT-Live adapter has 18 injected guard tests, but the actual gateway returned Live 404; **working GPT live audio is not claimed**.

## Follow the demonstration

1. **Ask.** “Our customer needs 150 black T-shirts by September 18. Keep it within $1,800.” The sample split option costs $1,750; standard arrives late and express exceeds that budget.
2. **Check.** Inspect source rows, the Hotdata query and cleanup receipts, the deadline and shipment constraints, and the agreeing local Play and cloud cross-check.
3. **Revise.** “Actually, make it 140.” The eligible split option becomes $1,630. An earlier approval is invalidated.
4. **Approve.** “Yes, I approve this exact proposal.” Approval binds the current quantity, budget, facts, policy, proposal and revision. A later change clears it.
5. **Prepare work.** Produce the approved work packet, launch kit and recipient-free Gmail draft; publish the explicitly approved sample ticket to the fixed project repository. A fixed supplier-page read runs on the existing Tenki computer, with a screenshot and receipt.
6. **Inspect optional actions.** The Printful action creates or reconciles one unsubmitted sample draft. The separate owner-email action is limited to one fixed recipient and exact approved content, with a provider readback; the actual receipt and independent owner-account readback confirm Sent and Inbox labels; no external-recipient delivery is claimed.
7. **Remember.** Teach “never split shipments.” A new conversation recalls the policy and refuses the $1,800 plan; increasing the budget to $2,000 permits express at $1,950.

Recorded provider responses are real; prices, stock and rates are demonstration data. Edited narration and shortened waiting time are described in the media transcript and proof. The final film is based on the one complete successful fresh take identified above, with actual action receipts. Edited timing, narration and any editorial imagery are disclosed in its transcript and media proof; failed takes are excluded.

## How a request becomes approved work

The browser accepts text or an audio note. A bounded whisper.cpp process transcribes recorded audio locally. The Swift FoundationModels helper proposes structured intent; deterministic validation preserves the user's quantity, budget and approval meaning before any action proceeds.

Fresh review data is loaded into three separate Hotdata databases for inventory, rates and rules. Three fixed queries run concurrently. Inventory calculations exclude reservations, quality holds and late lots. A negative cross-catalog query checks isolation; explicit deletion and confirmation close every database. An unchanged snapshot can be reused for five minutes, and the receipt distinguishes that case from a fresh wave.

The quote engine evaluates standard, express and split delivery against budget, date and shipment policy. HydraDB supplies the order's deadline and policy constraints. The captured Rote review Play independently computes the result. With the private allowance enabled, a RocketRide staging Python sandbox cross-checks the same deterministic proposal. A mismatch or enabled-provider failure stops approval; it does not silently substitute a local success.

Approval binds the exact reviewed state. The second Rote Play creates a work packet only while that approval is current. Company notes and approvals are stored as validated raw-document revisions in Cognee and restored into new conversations, with stale-revision protection. Progress events describe real actions and saved receipts. Browser, Gmail, ticket, supplier-draft and owner-email capabilities each have their own explicit limits.

## What each of the six sponsors contributes

| Sponsor | Actual job | Scope and evidence |
|---|---|---|
| **Hotdata** | Concurrent, role-scoped SQL supplies inventory, shipping and policy rows for a fresh quote. | Three databases per wave, negative isolation probe and confirmed deletion. `hotdata-order-proof.json`, `hotdata-cleanup-reconciliation.json`, final demo proof. Local code coordinates the queries; no claim that cloud agents fan out. |
| **HydraDB** | Returns the current order's deadline and shipment-policy constraints to the review Play. | Direct local graph projection over Bolt; `integrated-review.json`, `full-flow-verification.json`. No cross-order multi-hop graph retrieval. |
| **Rote** | Replays captured order-review and approved work-packet procedures. | Two inspectable Plays and both replay checks; `rote-plays-proof.json`, `plays/`. No measured token or speed improvement is claimed. |
| **RocketRide** | Runs a deterministic Python quote cross-check in its staging sandbox before approval. | Returned result must agree; task termination and credit receipts are retained. `rocketride-cloud-proof.json`, `integrated-cloud-flow.json`. It hosts the verification pipeline, not the public site or Apple model. |
| **Cognee** | Saves company-memory revisions and restores the newest validated notes for another conversation. | Raw-document dataset; `cognee-cache-recovery.json`, `full-flow-verification.json`. No Cognify, embeddings or semantic graph generation in this flow. |
| **Snyk** | Scans the exact exported code and resolved dependencies. | Four fresh scan scopes and unsuppressed findings in `evidence/snyk/` and `SECURITY.md`. Build-time verification, not a live chat action. |

Tenki supplies the existing cloud computer for fixed public-page reading and approved-file uploads. Apple, whisper.cpp, Microsoft Ava, Gmail, Printful and GitHub have distinct supporting roles; they are not substituted for those six sponsor claims. Higgsfield footage, if present in the final film, is labelled editorial imagery rather than evidence of an app action.

## Source, tests, evidence and assets

Paths below are relative to the exported repository. This walkthrough is installed at `docs/FULL-WALKTHROUGH.md`; other documentation links refer to that directory.

| Capability | Modules and tests | Evidence / exported assets |
|---|---|---|
| Conversation and approval | `src/local-conversation.ts`, `conversation-model.ts`, `approval-proof.ts`, `company-workspace.ts`; extracted `tests/order-desk.test.ts` | Current approval revision and quote receipts; `fixtures/company.json` |
| Progress and workspace | `src/live-progress.ts`, `workspace-map.ts`; `tests/workspace-map.test.ts` | Actual progress events; twelve stock lots with reservations and holds |
| Static playground | `src/public-preview.ts`, `public-data/preview.js`, `scenarios.json`; workspace parity tests | Original data/engine plus `docs/data/`; actual three-scenario calculations |
| Public frontdoor | `docs/index.html`, `docs/site.css`, `docs/site.js` | `docs/index.html`, `site.css`, `site.js`; desktop/mobile, keyboard and calculation checks |
| Data and constraints | `data-workers.ts`, `hotdata-http.ts`, `native/hydra_order.py` | Sanitized sponsor receipts, source rows and cleanup records |
| Reusable procedures | `local-procedures.ts`, `procedures/`, `plays/` | Both actual replay checks and `.rote-flow-lint.json` |
| Memory and cloud agreement | `cognee-memory.ts`, `rocketride-cloud.ts`, `pipelines/`; 13 fake-client RocketRide tests | Recovery, cloud agreement and termination receipts |
| Browser / Tenki | `browser-actions.ts`, `tenki-browser.ts`; both test modules; `scripts/tenki-browser-read.mjs` | `public-cloud/*`; exact existing-session guard tests; no private SDK credentials or allowance copied |
| Launch kit and ticket | `work-ticket.ts`; `tests/work-ticket.test.ts` | Exact approved public issue URL; stale approval and fixed-destination guards |
| Unsent Gmail draft | `gmail-draft.ts`; `tests/gmail-draft.test.ts` | Recipient-free draft; portable `gws` executable lookup; no OAuth state |
| Owner demo email | `project-email.ts`; three tests | Fixed-recipient/content guards, metadata GET regression and known-message readback retry; actual sent receipt |
| Supplier sample draft | `printful-draft.ts`; five tests | External-ID length regression, reconciliation and quantity-one/unsubmitted guards; no recipient address exported |
| Speech and optional Live | `natural-voice.ts`, `gpt-live.ts`, `gpt-live-browser.ts`; 18 Live guard tests | Ava working; Live gateway blocked. Python pins and scan include edge-tts 7.2.8 |
| Event companion | `event-workspace/src`, `runtime`, `migrations`, `tests`, `public` | 18 tests, typecheck, runtime bundle, separate dependency scan; no participant database |
| Official sponsor marks | `public/sponsors/*` | Original assets and `sponsor-logo-sources.json`; also copied under `docs/sponsors/` |
| Video and presentation | ROOT `submission/*` and canonical config | Published MP4, poster, VTT captions, transcript, PDF and sanitized proofs; hashes in the final manifest |

## Run it yourself

For the public playground only, clone the isolated repository and serve `docs/`:

```sh
git clone https://github.com/gtrush03/synth-order-desk.git
cd synth-order-desk
python3 -m http.server 8080 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:8080`. This sample-only path needs no provider account.

For the full Mac assistant, read `PLATFORM.md`, then run `judge/setup.sh`, `judge/test.sh` and `judge/start.sh`. It needs macOS 26 with Apple Intelligence, Xcode command-line tools, the pinned transcription tools, and local Cognee and HydraDB services. Exact package versions and lockfiles are exported. Configure your own optional provider access explicitly in the documented environment and allowance files; private operator settings are not copied or automatically loaded.

The distribution uses RocketRide SDK 1.3.0, Tenki SDK 1.0.6 and Playwright 1.56.0. The original recorded guest used Playwright 1.55.0; that historical provenance is retained. Main Python requirements include Neo4j 6.3.0 and edge-tts 7.2.8. The Event development CLI is pinned separately to Wrangler 4.96.0, with its current advisories disclosed.

## Deployment and production limits

The static hub can be served from `docs/` on a static host. It never needs the private Mac data directory. The conversational service remains local; RocketRide runs its deterministic verification pipeline; Tenki hosts temporary computer views. The event workspace has its own consent deadline. Durable video, PDF and source are independent of all temporary runtime links.

This is an inspectable hackathon prototype. Public multi-user authentication, tenant separation, durable hosted reasoning, operational recovery, verified billing hard stops across all providers, general supplier fulfillment and production security remediation remain future work. Supplier draft creation does not submit, pay or ship an order; an email provider SENT readback does not prove recipient delivery. Artwork processing is not print readiness. No production-completion percentage or winning probability is asserted.

The operator authorized one $10.50 Cloudflare funding action with automatic refill off; this does not establish a general spend cap. Runtime allowances bound specific actions but are not a promise of provider billing protection. The Tenki adapter's hard limit is six additional reads and six approved uploads per allowance, on the existing VM only. The current Hotdata allowance permits twenty total waves; counters and remaining quota must be read from actual runtime receipts rather than inferred from this document.

## Evidence and final acceptance

`EXPORT-MANIFEST.json` records the exact copied files, source hashes, portable rewrites, test results and scan scopes. `PROVENANCE.md` explains private-source isolation. The package excludes credentials, private transcripts, participant data, recipient addresses and host history; reviewed guest scripts and cloud assets are explicitly allowlisted.

The published export was accepted against its matching source-and-media freeze. George confirmed form submission. The original published application is preserved at commit8226a62; later documentation, setup and media refinements are visible in history. The old 110-file candidate18 and its nine Code findings remain preserved as historical evidence, but their scan results do not describe this expanded package. Current source, media and publication receipts are kept distinct.

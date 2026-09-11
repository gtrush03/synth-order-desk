# TRU SYNTH · Order Desk

**Turn order changes into approved work.**

Tell Synth what you need. It checks the numbers, asks for approval, prepares real work and remembers your rules next time.

Created with **Codex CLI**, using **SYNTHOS** by [TRU SYNTH](https://trusynth.com).

## Watch the complete demo

https://github.com/user-attachments/assets/dcd43ede-b237-4bee-8b06-0be3b3f1a46c

**98 seconds · narrated and captioned · one fresh session · 18 verified steps**

[Watch in full HD](https://trusynth-order-desk.pages.dev/submission/synth-order-desk-demo.mp4) · [Try the public playground](https://trusynth-order-desk.pages.dev/) · [Seven-slide presentation](https://trusynth-order-desk.pages.dev/submission/Synth-Order-Desk.pdf) · [Proof index](docs/EVIDENCE-MAP.md)

Built by **George Trushevskiy · team GEORGE** for the September 11, 2026 Data & AI Hackathon at AWS Builder Loft. **Main Track → Compound Agents**, adapting the suggested *Compounding Support Desk* to merchandise operations. Primary sponsor category: **Best Use of Hotdata**. Secondary: **RocketRide**. [Category evidence](evidence/submission-category.json).

## One request, real follow-through

A team needs **150 shirts by September 18 within $1,800**. Synth finds a feasible $1,750 split shipment. “Make it 140” changes the quote to **$1,630** and clears the old approval.

After explicit approval, Synth creates a reusable work packet, reads the supplier website on a Tenki cloud computer, saves the launch kit and Gmail draft, and publishes the [approved work ticket](https://github.com/gtrush03/synth-order-desk/issues/6). It verifies a real **one-shirt Printful sample draft** and sends the approved demo email to the owner.

Then the owner says **“Never split shipments.”** A new conversation remembers: the $1,800 request becomes infeasible. Raising the budget to $2,000 makes express delivery at **$1,950** possible. Memory changes the decision and the allowed actions.

| Film chapter | What you see |
|---|---|
| 00:00 · Ask | A voice note becomes a concrete order request. |
| 00:14 · Check | Source data, parallel SQL, shipping choices and cloud verification. |
| 00:28 · Approve | A revised quote waits for explicit approval. |
| 00:33 · Act | Saved work, cloud browser, sample draft and owner email. |
| 01:03 · Remember | A fresh conversation applies the new shipping rule. |

[Full walkthrough](docs/FULL-WALKTHROUGH.md) · [Narration and disclosures](submission/TRANSCRIPT.md) · [Full source capture](submission/full-session.mp4)

## Six sponsors, each with a concrete job

| Technology | What actually ran | Inspect |
|---|---|---|
| **Hotdata** | Inventory, shipping and policy use three separate databases per fresh review. Queries overlap; isolation is probed; every database is deleted. | [Actual query rows, IDs and cleanup](evidence/final-flow-receipts.json) · [Worker code](src/data-workers.ts) |
| **HydraDB** | Retrieves the order's deadline and shipment constraints for the review. | [Constraint receipt](evidence/integrated-review.json) · [Bridge](native/hydra_order.py) |
| **Rote** | Two captured Plays recompute the quote and produce the approved work packet. | [Replay proof](evidence/rote-plays-proof.json) · [Plays](plays/) |
| **RocketRide** | Its staging Python sandbox independently checks the quote before approval. | [Fresh cloud receipts](evidence/final-flow-receipts.json) · [Both pipeline files](pipelines/) |
| **Cognee** | Stores company-memory revisions and restores the newest validated rules in another conversation. | [Recovery proof](evidence/cognee-cache-recovery.json) · [Memory code](src/cognee-memory.ts) |
| **Snyk** | Scans the submitted source and resolved dependencies. | [Results and dispositions](docs/SECURITY.md) |

**Fresh-take proof:** two Hotdata waves, **six databases created and six deletions confirmed**, query overlap of **318 ms and 399 ms**, and four agreeing RocketRide checks with terminated tasks. [Complete evidence](submission/DEMO-PROOF.json).

Tenki provides the cloud computer. Apple FoundationModels interprets requests, whisper.cpp transcribes voice notes, and Microsoft Ava speaks confirmed replies. Gmail, Printful and GitHub perform the bounded follow-through. [Architecture](docs/ARCHITECTURE.md).

## Try it

**Anyone can try the three sample scenarios** in the [public playground](https://trusynth-order-desk.pages.dev/). Change quantity, budget and shipping rules; inspect the stock and rate rows behind the result. This browser calculator needs no account or API key.

For the full conversational assistant, use macOS 26 with Apple Intelligence and Xcode command-line tools. Follow [platform and service setup](docs/PLATFORM.md), including [the local Cognee recipe](docs/COGNEE-SETUP.md), then:

```sh
git clone https://github.com/gtrush03/synth-order-desk.git
cd synth-order-desk
judge/setup.sh
set -a; source judge.env; set +a
judge/test.sh
judge/replay-plays.sh
judge/start.sh
```

Open `http://127.0.0.1:7790/talk`. Provider capabilities require your own explicitly enabled access. The company-data mode can use local files; unmuted Ava speech uses Microsoft's service. Choose **Voice off** for typed replies without speech synthesis. The public site does not host the Mac model.

## What judges can verify

- **4,870 lines of code across 82 files:** 3,652 product lines and 1,218 test/tooling lines, excluding dependencies, generated Cloudflare declarations and duplicate assets. [Reproducible count](evidence/final-flow-code-stats.json).
- **99 passing tests:** 68 Node, 13 RocketRide adapter and 18 Event tests; type checks, builds, Play replays, speech/model checks and server smoke. [Exact log](evidence/self-check/self-check.txt).
- **A complete fresh run:** empty starting chat, actual provider receipts, no failed take spliced into the film. [Flow proof](submission/DEMO-PROOF.json) · [Media hashes and QA](submission/MEDIA-PROOF.json).
- **Inspectable source:** application, native helper, both Plays, `.pipe` exports, synthetic fixtures, tests, lockfiles, cloud-view source and separate event companion. [Package map](docs/EVIDENCE-MAP.md).
- **Distribution integrity:** run `python3 judge/verify-export.py` on a clean checkout. [Manifest](EXPORT-MANIFEST.json) records file hashes, portable rewrites and check provenance.

## Scope and next steps

Stock and prices are labelled sample data. Printful draft **176055721** contains one sample shirt, is unsubmitted and unpaid, and has unconfirmed artwork readiness. It does not purchase the 140-shirt plan. Email is owner-only; its Sent and Inbox labels were checked. Temporary Tenki views expire independently of the durable video and source.

Cognee uses raw-document memory; RocketRide runs deterministic Python, with four checks sharing one task identity. The implementation does not claim a generated knowledge graph, cloud language-model fan-out, arbitrary browser autonomy or working GPT Live audio.

Main npm and Python scan scopes are clean. **16 Code findings and 29 Event development-dependency findings remain disclosed**, plus the separate Cognee runtime advisory. [Security details](docs/SECURITY.md).

The practical direction is recurring operations for merchandise teams, event organizers and creators. Production work includes hosted reasoning, authentication, tenant isolation, reliable recovery and security remediation. Market fit still needs customer validation.

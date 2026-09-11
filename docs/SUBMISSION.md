# Submission text (ROOT reviews and posts after publication)

**Project:** Synth Order Desk — Voice requests. Real work. Clear approval.

Tell Synth what you need. Review the plan. Let it do the work.

**Track / category:** Main Track — Compound Agents (adaptation of the suggested Compounding Support Desk idea to merchandise orders). Sponsor prizes pursued: Best Use of Hotdata (primary), RocketRide (secondary). No Parallel Agents or Best Agent Telemetry claim.

**Repository:** https://github.com/gtrush03/synth-order-desk · the final published commit is recorded by ROOT at publication.

**Recording:** [captioned demonstration](../submission/synth-order-desk-demo.mp4), [English captions](../submission/captions.vtt), [narration transcript](../submission/TRANSCRIPT.md). Publication target: https://trusynth-order-desk.pages.dev/ .

**What it does:** a merch-studio owner talks or types an order change; the Synth interprets it with Apple's on-device model, checks stock, rates and policy in three scoped Hotdata databases, reads the order's deadline and shipment rule from HydraDB, recomputes the quote through a captured Rote Play (and, when enabled, cross-checks it in a RocketRide staging sandbox), records only an explicit approval, writes the approved work packet with an unsent customer reply through a second Rote Play, and stores each company-memory revision in Cognee for the next conversation. The original sponsor recording uses local Whisper and Apple reasoning. Optional GPT voice, owner-only email and supplier-draft source are separate features; only their own dated acceptance receipts establish a real run. No paid supplier confirmation is claimed.

**What ran live on September 11:** the full conversation flow with Hotdata, HydraDB, Rote and Cognee (`evidence/full-flow-verification.json`); the served conversation with the RocketRide cloud cross-check on both quotes, explicit approval and the Rote packet (`evidence/integrated-cloud-flow.json`); the standalone RocketRide staging sandbox proof (`evidence/rocketride-cloud-proof.json`); owner-confirmed physical microphone and speech (`evidence/physical-voice-check.json`).

**Sponsors, one line each:**
- Hotdata — three role-scoped databases per fresh review, concurrent SQL with returned rows and query IDs, negative cross-catalog probe, deletion, receipts.
- HydraDB — order → deadline / policy constraints written and read back per review; the returned values feed the review Play.
- Cognee — each company-memory revision stored as a raw document and restored by later conversations with stale-revision protection (no cognify or semantic graph).
- Rote — two captured Plays, `plays/order-review/main.ts` and `plays/work-packet/main.ts`, executed on every review and every approved packet; stale approvals refused.
- RocketRide — gated cloud cross-check of the review in a pure-Python `tool_python` sandbox on staging; verdict must agree before approval; credit-floor guard; standalone proof receipt.
- Snyk — the current exported dependency and Code scan results are in docs/SECURITY.md and evidence/snyk. Historical candidate18 had nine open Code findings; its dependency results do not certify this expanded source. The inherited local Cognee1.5.4 critical advisory stays disclosed.

**Limits:** sample stock and prices; one unsubmitted, unpaid Printful sample draft with artwork readiness unconfirmed; fixed-owner demo email requires its own send/readback receipt. Recipient-free Gmail drafts and the fixed public work ticket require explicit allowance. Apple reasoning runs on the Mac; Ava speaks confirmed replies. GPT Live audio remains unavailable. The public playground and temporary Tenki views are separate. Market fit is a hypothesis.

---

## Discord paste (short)

Synth Order Desk — Tell Synth what you need. Review the plan. Let it do the work. Change a sample shirt order, check the revised price and shipping, approve the plan, and prepare real saved work. Hotdata, HydraDB, Rote, RocketRide and Cognee power the recorded checks and memory; Snyk findings stay visible. Source: https://github.com/gtrush03/synth-order-desk . Public hub and captioned recording publication target: https://trusynth-order-desk.pages.dev/ . Sample data, explicit approval, dated receipts; no paid supplier order or arbitrary-agent claim.

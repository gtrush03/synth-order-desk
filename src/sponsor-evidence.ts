/**
 * Sponsor evidence shown on /talk and /demo.
 * Every statement below is tied to a dated local receipt under control-room/evidence/ (served at /evidence/<id>).
 * Keep proof and gaps honest: what actually ran on this Mac today, what is bounded, what is still open.
 * Fields id, name, role, tag, phases, job, proof, next and receipt are also read by src/stage.ts.
 */
export type SponsorStatus = 'live' | 'verified' | 'open';
export interface SponsorEvidence {
  id: string; name: string; role: string; tag: string; phases: string[]; job: string; proof: string; next: string; receipt: string;
  /** live: runs inside the actual conversation; verified: verified today but not used by the conversation; open: not proven. */
  status: SponsorStatus;
  /** Conversation event ids (src/local-conversation.ts) that show this sponsor actually ran. */
  eventIds: string[];
  /** Only count the event when its label includes this text (Hotdata shares the company-data event with local files). */
  eventLabelIncludes?: string;
  /** What the activity rail says before the sponsor has run in this conversation. */
  idle: string;
  gaps: string[];
  receipts: { id: string; label: string }[];
  verifiedAt: string;
}
export interface LocalStack { id: string; name: string; eventIds: string[]; idle: string; open: false }

export const EVIDENCE_NOTE = 'Times are Pacific, September 11, 2026. Every verified statement links to a dated local receipt on this Mac. Nothing here claims cloud execution, a purchase, a supplier order or a sent message.';

/** The local stack is not a sponsor; it appears in the activity rail so the audience sees where each step ran. */
export const LOCAL_STACK: LocalStack[] = [
  { id: 'apple', name: 'Apple on-device model', eventIds: ['local-language-model'], idle: 'Interprets your next message on this Mac', open: false },
  { id: 'whisper', name: 'Local Whisper', eventIds: [], idle: 'Transcribes voice notes on this Mac', open: false },
  { id: 'desk', name: 'Order desk', eventIds: ['company-memory', 'local-options', 'local-approval', 'local-memory', 'local-draft'], idle: 'Checks options, records approval, writes drafts', open: false }
];

export const SPONSORS: SponsorEvidence[] = [
  {
    id: 'hotdata', name: 'Hotdata', status: 'live', verifiedAt: '2026-09-11T19:21:48Z',
    role: 'A scoped database for each order role.',
    tag: 'Ran inside this product today',
    phases: ['options', 'replay'],
    job: 'For every order review, three separate Hotdata databases hold only that role’s table: inventory, shipping rates and policy rules. Each role loads its table by inline CSV, the three SELECT queries run with overlapping request intervals, the query run ids and returned rows are kept in a per-turn receipt, and the databases are deleted.',
    proof: 'At 12:21 PM the actual conversation created three scoped databases, ran the three queries with 1,619 ms of overlapping request intervals, kept three query run ids with the returned rows, confirmed that the inventory database could not read the shipping catalog (HTTP 400) and deleted all three in an eight-second lifecycle. The 11:59 AM turn measured 1,042 ms. Cleanup was reconciled at 12:19 PM with no remaining databases. The 12:51 PM rehearsal on the served app ran one more wave live in the conversation: 367 ms overlap, three databases destroyed, cross-catalog read denied. The 1:00 PM cloud-integrated flow used one more; nine of the twelve bounded runs are used.',
    next: 'A bounded free-credit proof: at most 12 runs of 25 KB input on the displayed $95 balance, allowed until 5 PM (six used by 12:35 PM), with a five-minute verified snapshot reused between runs. Overlapping intervals are a measured overlap, not a speedup. Scoping is by database and table inside one workspace, not a separate credential per worker, and the local coordinator fans out the SQL; this is not RocketRide agent fan-out. No provider hard overage cap was verified.',
    receipt: 'hotdata-order-proof',
    eventIds: ['company-data'], eventLabelIncludes: 'Hotdata',
    idle: 'Runs on the next order review',
    gaps: [
      'Bounded proof: 12 runs, 25 KB input each, on existing free credit until 5 PM (six used); a verified snapshot under five minutes old is reused instead of a fresh call.',
      'Overlapping request intervals are a measured overlap, not a speedup benchmark.',
      'Scoping is per database and table in one workspace, not a per-worker credential boundary; the local coordinator issues the SQL, so this is not RocketRide agent fan-out.',
      'Per-turn JSON receipts are not a persistent cross-run telemetry database.',
      'No provider hard overage cap was verified; the promo code offered today was rejected.'
    ],
    receipts: [
      { id: 'hotdata-order-proof', label: 'Scoped concurrent order queries, rows and cleanup · 12:21 PM' },
      { id: 'integrated-cloud-flow', label: 'Hotdata inside the cloud-integrated served conversation · 1:00 PM' },
      { id: 'integrated-review', label: 'Hotdata → HydraDB → Rote in one actual turn · 11:59 AM' },
      { id: 'hotdata-cleanup', label: 'Cleanup reconciliation: no remaining databases · 12:19 PM' },
      { id: 'hotdata-credits', label: 'Existing free credit; promo code rejected · 11:49 AM' }
    ]
  },
  {
    id: 'hydradb', name: 'HydraDB', status: 'live', verifiedAt: '2026-09-11T19:21:49Z',
    role: 'The order’s constraints as a graph.',
    tag: 'Ran inside this product today',
    phases: ['options', 'approved', 'replay'],
    job: 'Each review writes the order node with its deadline and shipment policy into the local HydraDB graph, queries those constraints back and hands the returned rows to the Rote review Play. The graph answer, not a hard-coded rule, shapes the proposal.',
    proof: 'At 12:21 PM the conversation queried two constraints from HydraDB in 30 ms and the review Play used them: with “never split shipments” remembered, express at $1,950 was chosen instead of split; after “allow split shipments”, split at $1,750 was chosen again. The 11:59 AM turn shows the same path with its order node id.',
    next: 'The constraint set is small: deadline and shipment policy. The morning ownership and blocker queries are a separate read-only receipt. HydraDB runs locally on Bolt 7687; no hosted graph is claimed.',
    receipt: 'full-flow',
    eventIds: ['hydra-constraints'],
    idle: 'Runs on the next order review',
    gaps: [
      'Two explicit constraints per run (deadline, shipment policy) projected from the current notes; not a Cognee-built graph and no multi-hop retrieval over accumulated history.',
      'Local HydraDB container on Bolt 7687; nothing hosted or shared.'
    ],
    receipts: [
      { id: 'full-flow', label: 'Policy change alters the chosen option · 12:21 PM' },
      { id: 'integrated-review', label: 'Constraints supplied to the review Play · 11:59 AM' }
    ]
  },
  {
    id: 'rote', name: 'Rote', status: 'live', verifiedAt: '2026-09-11T19:21:50Z',
    role: 'Replay the captured procedure.',
    tag: 'Two Plays ran inside this product today',
    phases: ['replay'],
    job: 'Two captured Plays. order-review recalculates the three options for any quantity and budget; work-packet turns an explicit approval into the unsent customer reply plus the work that still needs a human. Every conversation review replays the Play and must agree with the current proposal, or approval pauses.',
    proof: 'Rote 0.82.0 ran order-review inside the conversation at 11:59 AM (467 ms) and 12:21 PM (493 ms), and work-packet at 12:21 PM (119 ms) to write the approved packet. The standalone check at 12:01 PM ran both Plays for 100, 140 and 150 shirts, and the packet Play refused a stale approval.',
    next: 'The Plays are deterministic replays of the captured method; they contain no model reasoning. Their millisecond timings are not a claim of savings against a model call. Run ids are recorded per turn in the conversation activity.',
    receipt: 'rote-plays-proof',
    eventIds: ['rote-review', 'rote-packet'],
    idle: 'Replays on each review and approved packet',
    gaps: [
      'Deterministic replays of a captured method; no model reasoning inside a Play.',
      'Play timings are wall-clock for the replay, not a measured saving against a model wake; the on-device intent model still runs on every turn.'
    ],
    receipts: [
      { id: 'rote-plays-proof', label: 'Both Plays for 100, 140 and 150 shirts; stale approval refused · 12:01 PM' },
      { id: 'integrated-cloud-flow', label: 'Packet Play with the matching approval revision after cloud verdicts · 1:00 PM' },
      { id: 'full-flow', label: 'Packet Play inside the conversation · 12:21 PM' }
    ]
  },
  {
    id: 'cognee', name: 'Cognee', status: 'live', verifiedAt: '2026-09-11T19:21:51Z',
    role: 'Company memory that outlives the conversation.',
    tag: 'Raw recall ran inside this product today',
    phases: ['approved', 'replay'],
    job: 'Every change to company instructions or approvals is stored as a raw document in a local Cognee dataset. A fresh conversation retrieves the latest revision before its first turn, so an instruction given once changes later proposals.',
    proof: 'At 12:21 PM a fresh conversation retrieved revision 2 of the company memory from the local Cognee dataset, and the remembered “never split shipments” changed the chosen option to express. Revisions 3 and 4 were saved after the approval and the later instruction. At 12:35 PM an empty isolated cache was restored from the Cognee dataset alone: revision 0 to 4, three notes and one approval, with older revisions refused.',
    next: 'Cognee is used as raw dataset storage and retrieval on the local API at port 8765. No cognify, embeddings, graph completion or semantic search ran; those need a model and are not claimed. The DATAANDAI35 code is recorded but not redeemed or verified.',
    receipt: 'full-flow',
    eventIds: ['cognee-recall', 'cognee-save', 'cognee-save-pending'],
    idle: 'Saves when instructions or approvals change',
    gaps: [
      'Raw document storage and retrieval only; no cognify, embeddings, graph completion or semantic search.',
      'Local Cognee 1.5.4 API on port 8765; the DATAANDAI35 code is recorded, not redeemed or verified.'
    ],
    receipts: [
      { id: 'full-flow', label: 'Remember → fresh recall → changed choice → saved revisions · 12:21 PM' },
      { id: 'full-walkthrough', label: 'Full walkthrough with the 12:35 PM cache-recovery receipt' },
      { id: 'cognee-cache-recovery', label: 'Empty cache restored from the Cognee document, revision 0 → 4 · 12:35 PM' }
    ]
  },
  {
    id: 'rocketride', name: 'RocketRide', status: 'live', verifiedAt: '2026-09-11T20:00:31Z',
    role: 'Verify the proposal in the cloud before approval.',
    tag: 'Ran inside this product today',
    phases: ['options'],
    job: 'Each reviewed proposal is sent to a RocketRide staging task that recomputes the quote from the same company facts and returns its own proposal. The conversation consumes that returned proposal before approval: if the cloud task fails, disagrees or does not terminate, the proposal and approval pause. No local-quote fallback.',
    proof: 'At 1:00 PM the served conversation ran two RocketRide staging tasks (task 07b0c8f2, 15.7 s and 10.4 s, both terminated) for 150 shirts at $1,750 and 140 shirts at $1,630. The returned cloud proposals matched, the explicit approval was recorded against them, and the Rote work packet carried the matching approval revision. Live balance was checked before each task: 4,819.9 to 4,819.1 grant units, 0.5 and 0.3 units attributed in the ledger, no model call.',
    next: 'This is a deterministic tool_python sandbox task on the staging grant, not a multi-agent wave and not a paid model. Credit units are not dollars; no cash charge was created. Overage protection and prize attribution remain unverified beyond the bounded ledger.',
    receipt: 'integrated-cloud-flow',
    eventIds: ['rocketride-review'],
    idle: 'Verifies the next reviewed proposal',
    gaps: [
      'Deterministic sandbox tool on the staging grant; no model inference and no multi-agent fan-out is claimed.',
      'Bounded task ledger on free credit units; not a dollar amount and not a verified overage cap.',
      'Per-turn receipts are not a persistent telemetry database across runs.'
    ],
    receipts: [
      { id: 'integrated-cloud-flow', label: 'Served conversation with two cloud verdicts and the approved packet · 1:00 PM' },
      { id: 'rocketride-cloud-proof', label: 'Cloud sandbox quote checks' },
      { id: 'rocketride-cloud-ledger', label: 'Bounded task ledger and cleanup' },
      { id: 'rocketride-staging-credits', label: 'Staging grant and credit ledger, credential excluded · 11:08 AM' }
    ]
  },
  {
    id: 'snyk', name: 'Snyk', status: 'verified', verifiedAt: '2026-09-11T20:13:54Z',
    role: 'Inspect the code judges receive.',
    tag: 'Code scan enabled today; open findings remain; dependency scope clean',
    phases: ['proof'],
    job: 'Scan the isolated judge export, dependencies and code, keep every finding visible, and fix what is ours before the final rescan.',
    proof: 'Snyk Code was enabled on the existing free organization at 1:10 PM (setting false → true through an authorized API change; no upgrade). The sanitized export scope was scanned the same afternoon and is not clean: open Code findings remain, including DOM-XSS warnings on this page’s innerHTML sinks and server findings (path traversal, error-message exposure, an HTTP warning). The current count lives in the judge package and its fresh scan, not here. The dependency scan of that scope (38 npm, 2 Python packages) reported no findings.',
    next: 'Root triages the server findings. This page routes every interpolation through an escaper, only places same-origin receipt and artifact paths in links, and runs under a CSP that forbids inline script and style. The UI changed after the scan, so a fresh Code scan of the final export is required before submission. Advisories inherited from the separate lab services are disclosed, not resolved.',
    receipt: 'judges-repo',
    eventIds: [],
    idle: 'Not part of the conversation; scans the export',
    gaps: [
      'Open Snyk Code issues remain on the export scope; nothing is called exploitable or a false positive before triage, and the count comes from the final scan.',
      'The final export must be rescanned after these UI changes.',
      'Inherited service advisories from the earlier lab scope are disclosed, not resolved.'
    ],
    receipts: [
      { id: 'judges-repo', label: 'Judge package notes with the security scan status' }
    ]
  }
];

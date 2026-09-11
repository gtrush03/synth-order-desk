/**
 * RocketRide staging adapter for the talking Synth.
 *
 * Covered deterministic cloud path: a `tools` source hosts one `tool_python` sandbox node. The Synth calls
 * that sandbox directly through the RocketRide control plane (no agent, no LLM, no external model key,
 * no `${ROCKETRIDE_*}` substitution). The order-review procedure — the same arithmetic as
 * src/rehearsal-model.ts and the captured Rote Play — runs inside the cloud sandbox, and its proposal is
 * compared with the local quote. Every run preserves task identity, sanitized credit usage and the exact
 * input/output, and terminates its own task. Credentials are read from the existing staging .env only,
 * never printed, and never written into receipts.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { validateCompany, type CompanyData } from './company-workspace.ts';
import { sampleProposal, type SampleProposal } from './rehearsal-model.ts';
import { splitForbidden } from './conversation-model.ts';

export const SDK_PATH = process.env.ROCKETRIDE_SDK_PATH ?? 'rocketride';
export const STAGING_ENV_PATH = process.env.ROCKETRIDE_ENV_FILE ?? `${process.cwd()}/judge.env`;
export const STAGING_HOST = 'staging.rocketride.ai';
export const PIPE_PROJECT_ID = 'trusynth-order-review-cloud';
export const PIPE_SOURCE = 'tools_1';
export const PYTHON_NODE = 'tool_python_1';
export const RESULT_SENTINEL = 'SYNTH_RESULT:';
export const ENGINE = 'RocketRide staging tool_python sandbox';
export const ALLOWANCE_FILE = 'rocketride-allowance.json';
export const RUN_COUNT_FILE = 'rocketride-run-count.json';
export const MAX_TOOL_ATTEMPTS = 4;
export const MAX_INPUT_BYTES = 25000;

export interface ReviewCase { quantity: number; budgetCents: number; notes: string[] }
export interface PipelineComponent { id: string; provider: string; name: string; config: Record<string, unknown>; control?: { classType: string; from: string }[]; input?: { lane: string; from: string }[]; ui: Record<string, unknown> }
export interface PipelineDefinition { name: string; description: string; version: number; project_id: string; source: string; isLocked: boolean; viewport: { x: number; y: number; zoom: number }; components: PipelineComponent[] }
export interface CloudOutput { procedure: string; version: string; engine: string; inputSha256: string; proposal: SampleProposal; approved: boolean; cloudModelCalls: number }
export interface CloudAllowance { enabled: boolean; host: string; freeCreditConfirmed: boolean; minAvailableCredits: number; maxRuns: number; validUntil: string; proof: string }
export interface ToolAttempt { tool: string; argument: string; ok: boolean; ms: number; error?: string }
export interface CaseReceipt { quantity: number; budgetCents: number; notesCount: number; inputSha256: string; ms: number; agrees: boolean | null; differences: string[]; cloudChosen: string | null; localChosen: string | null; cloudOutput: CloudOutput | null; localReference: SampleProposal; attempts: ToolAttempt[]; error?: string }
export interface CloudReceipt {
  id: string; engine: typeof ENGINE; host: string; projectId: string; source: string; node: string; startedAt: string; finishedAt: string; ms: number;
  pipelineValidated: boolean | null; validationErrors: number | null; validationWarnings: number | null;
  taskTokenPrefix: string | null; taskTokenSha256: string | null; taskId: string | null; taskName: string; terminated: boolean;
  task: { state?: number; completed?: boolean; exitCode?: number; status?: string; startTime?: number; endTime?: number; tokens?: Record<string, number>; metrics?: unknown; errors?: number; warnings?: number } | null;
  credits: { unit: string; floor: number | null; availableBefore: number | null; availableAfter: number | null; consumedBefore: number | null; consumedAfter: number | null; unitsUsed: number | null; attributedTransactions: number | null; ledgerNote: string };
  cases: CaseReceipt[]; agrees: boolean | null; cloudModelCalls: 0; externalModelKeys: 0; paidCalls: 0; failure?: string;
}

// ---------- pipeline definition ----------
export function buildOrderReviewPipeline(): PipelineDefinition {
  return {
    name: 'Synth order review · RocketRide cloud sandbox',
    description: 'The talking Synth calls a RocketRide tool_python sandbox directly through the tools source. The deterministic order-review procedure runs in the cloud with no agent, no LLM and no external credential; its quote is compared with the local one before approval.',
    version: 1, project_id: PIPE_PROJECT_ID, source: PIPE_SOURCE, isLocked: false, viewport: { x: 0, y: 0, zoom: 1 },
    components: [
      { id: PIPE_SOURCE, provider: 'tools', name: 'Synth calls the sandbox directly (no agent, no LLM)', config: { hideForm: true, mode: 'Source', parameters: {}, type: 'tools' }, ui: { position: { x: 40, y: 200 }, nodeType: 'default', formDataValid: true } },
      { id: PYTHON_NODE, provider: 'tool_python', name: 'Order review procedure · pure Python, deterministic', config: { type: 'tool_python', timeout: 20, allowedModules: [] }, control: [{ classType: 'tool', from: PIPE_SOURCE }], ui: { position: { x: 360, y: 200 }, nodeType: 'default', formDataValid: true } }
    ]
  };
}

// ---------- deterministic program ----------
const PROGRAM = `import json, re
INPUT_JSON = __INPUT_JSON__
INPUT_SHA256 = "__INPUT_SHA256__"
inp = json.loads(INPUT_JSON)
company = inp["company"]; notes = inp["notes"]; quantity = inp["quantity"]; budget_cents = inp["budgetCents"]
def split_forbidden(notes):
    forbidden = False
    for note in notes:
        if re.search(r"(?:never|do not|don't|no)\\s+(?:use\\s+)?split|single shipment only", note, re.I): forbidden = True
        if re.search(r"(?:allow|permit)\\s+split|split shipments? (?:is|are) (?:okay|ok|allowed)", note, re.I): forbidden = False
    return forbidden
def sample_proposal(quantity, budget_cents, company):
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 1 or quantity > 200: raise ValueError("Use a whole quantity from 1 to 200 for this sample.")
    if isinstance(budget_cents, bool) or not isinstance(budget_cents, int) or budget_cents < 0 or budget_cents > 1000000: raise ValueError("Use a sample budget from $0 to $10,000, with at most two decimal places.")
    stock = min(quantity, company["stock"]["available"]); rush = max(0, quantity - stock)
    options = []
    for rate in company["shipping"]:
        if rate["id"] == "split":
            total = stock * company["stock"]["unitCents"] + rush * company["stock"]["rushUnitCents"] + rate["shippingCents"]
            explanation = "%d from stock + %d rush units + shipping; company source %s" % (stock, rush, company["id"])
        else:
            total = quantity * rate["unitCents"] + rate["shippingCents"]
            explanation = "%d units + shipping; company source %s" % (quantity, company["id"])
        options.append({"id": rate["id"], "name": rate["name"], "totalCents": total, "arrival": rate["arrival"], "onTime": rate["arrival"] <= company["deadline"], "explanation": explanation, "withinBudget": total <= budget_cents})
    feasible = sorted([o for o in options if o["onTime"] and o["withinBudget"]], key=lambda o: o["totalCents"])
    return {"quantity": quantity, "budgetCents": budget_cents, "options": options, "chosen": feasible[0] if feasible else None}
proposal = sample_proposal(quantity, budget_cents, company)
if split_forbidden(notes):
    feasible = sorted([o for o in proposal["options"] if o["id"] != "split" and o["onTime"] and o["withinBudget"]], key=lambda o: o["totalCents"])
    proposal["chosen"] = feasible[0] if feasible else None
result = {"procedure": "order-review", "version": "1.0.0", "engine": "RocketRide tool_python sandbox", "inputSha256": INPUT_SHA256, "proposal": proposal, "approved": False, "cloudModelCalls": 0}
print("${RESULT_SENTINEL}" + json.dumps(result, separators=(",", ":")))
`;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export function validateReviewCase(review: ReviewCase) {
  if (!Number.isInteger(review.quantity) || review.quantity < 1 || review.quantity > 200) throw new Error('Use a whole quantity from 1 to 200 for this sample.');
  if (!Number.isSafeInteger(review.budgetCents) || review.budgetCents < 0 || review.budgetCents > 1_000_000) throw new Error('Use a sample budget from $0 to $10,000, with at most two decimal places.');
  if (!Array.isArray(review.notes) || review.notes.length > 24 || review.notes.some(n => typeof n !== 'string' || n.length > 400)) throw new Error('Company notes must be at most 24 strings of 400 characters.');
  if (review.notes.some(n => /\$\{ROCKETRIDE_/i.test(n))) throw new Error('Company notes may not contain RocketRide substitution placeholders.');
}
/** Generates the sandbox program with the exact input embedded as an ASCII JSON literal; no substitution placeholders, no credentials. */
export function orderReviewProgram(company: CompanyData, review: ReviewCase): { code: string; inputSha256: string } {
  validateCompany(company); validateReviewCase(review);
  const inputJson = JSON.stringify({ company, notes: review.notes, quantity: review.quantity, budgetCents: review.budgetCents });
  if (Buffer.byteLength(inputJson, 'utf8') > MAX_INPUT_BYTES) throw new Error('The cloud review input is limited to 25 KB of company data and notes.');
  const inputSha256 = sha256(inputJson);
  const asciiJson = inputJson.replace(/[-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const literal = JSON.stringify(asciiJson);
  if (/\$\{ROCKETRIDE_/i.test(literal)) throw new Error('The sandbox program may not contain RocketRide substitution placeholders.');
  return { code: PROGRAM.replace('__INPUT_JSON__', () => literal).replace('__INPUT_SHA256__', () => inputSha256), inputSha256 };
}
/** The local quote the cloud result must agree with: rehearsal-model arithmetic plus the company shipment policy. */
export function localReference(company: CompanyData, review: ReviewCase): SampleProposal {
  validateReviewCase(review);
  const proposal = sampleProposal(review.quantity, review.budgetCents, company);
  if (splitForbidden(review.notes)) proposal.chosen = proposal.options.filter(o => o.id !== 'split' && o.onTime && o.withinBudget).sort((a, b) => a.totalCents - b.totalCents)[0] ?? null;
  return proposal;
}

// ---------- output handling ----------
function isCloudOutput(v: unknown): v is CloudOutput {
  const o = v as CloudOutput;
  return !!o && typeof o === 'object' && o.procedure === 'order-review' && typeof o.inputSha256 === 'string' && !!o.proposal && typeof o.proposal === 'object' && Array.isArray(o.proposal.options) && o.cloudModelCalls === 0 && o.approved === false;
}
/**
 * Collects every distinct order-review result from whatever shape the sandbox returns. The staging sandbox
 * returns `{stdout, stderr, exit_code, timed_out, result}` where `result` is the program's `result` variable
 * and stdout carries the same value behind the sentinel; identical copies collapse into one.
 */
export function extractCloudOutputs(raw: unknown, depth = 0): CloudOutput[] {
  const found: CloudOutput[] = [];
  if (typeof raw === 'string') {
    for (const line of raw.split(/\r?\n/)) {
      const at = line.indexOf(RESULT_SENTINEL); if (at < 0) continue;
      try { const parsed = JSON.parse(line.slice(at + RESULT_SENTINEL.length)); if (isCloudOutput(parsed)) found.push(parsed); } catch { /* not a result line */ }
    }
  } else if (raw && typeof raw === 'object' && depth < 4) {
    if (isCloudOutput(raw)) found.push(raw);
    else for (const value of Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)) found.push(...extractCloudOutputs(value, depth + 1));
  }
  if (depth > 0) return found;
  const distinct = new Map<string, CloudOutput>();
  for (const output of found) { const key = canonical(output); if (!distinct.has(key)) distinct.set(key, output); }
  return [...distinct.values()];
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
export const canonical = (v: unknown) => JSON.stringify(sortKeys(v));
/** Order-insensitive comparison of the local and cloud proposals with a readable list of differences. */
export function compareProposals(local: SampleProposal, cloud: unknown): { agrees: boolean; differences: string[] } {
  const differences: string[] = [];
  const c = cloud as SampleProposal;
  if (!c || typeof c !== 'object' || !Array.isArray(c.options)) return { agrees: false, differences: ['The cloud result has no proposal options.'] };
  if (c.quantity !== local.quantity) differences.push(`quantity ${local.quantity} vs cloud ${c.quantity}`);
  if (c.budgetCents !== local.budgetCents) differences.push(`budgetCents ${local.budgetCents} vs cloud ${c.budgetCents}`);
  for (const option of local.options) {
    const other = c.options.find(o => o && o.id === option.id);
    if (!other) { differences.push(`option ${option.id} missing in cloud`); continue; }
    if (canonical(option) !== canonical(other)) differences.push(`option ${option.id}: local ${option.totalCents}/${option.arrival}/${option.onTime}/${option.withinBudget} vs cloud ${other.totalCents}/${other.arrival}/${other.onTime}/${other.withinBudget}`);
  }
  if (c.options.length !== local.options.length) differences.push(`option count ${local.options.length} vs cloud ${c.options.length}`);
  if (canonical(local.chosen) !== canonical(c.chosen)) differences.push(`chosen ${local.chosen?.id ?? 'none'} vs cloud ${(c.chosen as SampleProposal['chosen'])?.id ?? 'none'}`);
  return { agrees: differences.length === 0 && canonical(local) === canonical(c), differences };
}

// ---------- credentials, redaction ----------
/** Reads only ROCKETRIDE_URI and ROCKETRIDE_APIKEY from the existing lab .env; the host must be staging. */
export async function loadStagingEnv(path = STAGING_ENV_PATH): Promise<{ uri: string; key: string }> {
  const env: Record<string, string> = {};
  for (const raw of (await readFile(path, 'utf8')).split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('='); const name = line.slice(0, at).trim().replace(/^export /, '');
    if (name === 'ROCKETRIDE_URI' || name === 'ROCKETRIDE_APIKEY') env[name] = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const uri = env.ROCKETRIDE_URI, key = env.ROCKETRIDE_APIKEY;
  if (!uri || !key) throw new Error('The existing RocketRide staging credentials were not found.');
  let host: string; try { host = new URL(uri).hostname; } catch { throw new Error('The RocketRide URI is invalid.'); }
  if (host !== STAGING_HOST) throw new Error(`Only ${STAGING_HOST} is authorized for this integration.`);
  return { uri, key };
}
export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.replaceAll(secret, '[redacted]');
  return out.replace(/\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,}){0,2}\b/g, '[redacted]').replace(/(Bearer\s+)[A-Za-z0-9._~-]{16,}/gi, '$1[redacted]');
}
export const maskToken = (token: string) => ({ prefix: token.slice(0, 6), sha256: sha256(token) });

// ---------- allowance (mirrors the bounded Hotdata allowance) ----------
export async function readAllowance(root: string): Promise<CloudAllowance | null> {
  try { return JSON.parse(await readFile(`${root}/${ALLOWANCE_FILE}`, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('The RocketRide allowance file is invalid.'); }
}
export function checkAllowance(a: CloudAllowance | null, now = Date.now()) {
  if (!a || !a.enabled) throw new Error('RocketRide cloud review is not enabled.');
  if (a.host !== STAGING_HOST) throw new Error(`RocketRide allowance host must be ${STAGING_HOST}.`);
  if (!a.freeCreditConfirmed || !a.proof) throw new Error('RocketRide needs a verified free-credit profile before a run.');
  if (!Number.isFinite(a.minAvailableCredits) || a.minAvailableCredits < 100) throw new Error('RocketRide allowance needs a minimum available credit floor of at least 100 units.');
  if (!Number.isInteger(a.maxRuns) || a.maxRuns < 1 || a.maxRuns > 20) throw new Error('RocketRide allowance maxRuns must be 1–20.');
  if (!(Date.parse(a.validUntil) > now)) throw new Error('The RocketRide allowance has expired.');
}
/** Claims one run before any network call. Failed runs count too; the caller serializes turns. */
export async function claimRun(root: string, allowance: CloudAllowance, now = new Date()): Promise<number> {
  let used = 0;
  try { used = JSON.parse(await readFile(`${root}/${RUN_COUNT_FILE}`, 'utf8')).used; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!Number.isInteger(used) || used >= allowance.maxRuns) throw new Error('The bounded RocketRide run allowance is exhausted.');
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/${RUN_COUNT_FILE}`, JSON.stringify({ used: used + 1, updatedAt: now.toISOString() }), { mode: 0o600 });
  return used + 1;
}

// ---------- client ----------
export interface DapResponse { success?: boolean; message?: string; body?: Record<string, unknown> }
export interface LedgerRow { idempotencyKey?: string; resource?: string; amount?: number; type?: string; createdAt?: string | null; context?: Record<string, unknown> | null }
/** The 8-character task id RocketRide writes into ledger context (`<id>.<source>`); derived from the task token, never the token itself. */
export const taskIdFromToken = (token: string) => token.replace(/^tk_/, '').slice(0, 8);
export function ledgerRowBelongsToTask(row: LedgerRow, token: string): boolean {
  if (typeof row.idempotencyKey === 'string' && row.idempotencyKey.includes(token)) return true;
  const taskId = row.context && typeof row.context === 'object' ? (row.context as { task_id?: unknown }).task_id : undefined;
  return typeof taskId === 'string' && taskId.startsWith(taskIdFromToken(token) + '.');
}
export interface CloudClient {
  connect(): Promise<unknown>; disconnect(): Promise<void>; isAuthenticated(): boolean;
  validate(options: { pipeline: unknown; source?: string }): Promise<{ errors: unknown[]; warnings: unknown[] }>;
  use(options: Record<string, unknown>): Promise<Record<string, unknown> & { token: string }>;
  buildRequest(command: string, options: { arguments?: Record<string, unknown>; token?: string }): Record<string, unknown>;
  request(message: Record<string, unknown>, timeout?: number): Promise<DapResponse>;
  didFail(response: DapResponse): boolean;
  getTaskStatus(token: string, options?: { timeout?: number | false }): Promise<Record<string, unknown>>;
  getTaskPipeline(token: string): Promise<Record<string, unknown> | undefined>;
  terminate(token: string): Promise<void>;
  account?: { getOrg(): Promise<{ id?: string; org?: { id?: string } }> };
  billing?: { getCreditBalance(orgId: string): Promise<{ balances: Record<string, number>; granted: Record<string, number>; consumed: Record<string, number> }>; getTransactions(orgId: string, options?: Record<string, unknown>): Promise<{ transactions: LedgerRow[]; total: number }> };
}
/** Builds the real SDK client against staging. IPv4-first name resolution is applied inside this process only. */
export async function createStagingClient(options: { requestTimeout?: number; env?: { uri: string; key: string } } = {}): Promise<{ client: CloudClient; secrets: string[]; host: string }> {
  const env = options.env ?? await loadStagingEnv();
  const dns = await import('node:dns'); dns.setDefaultResultOrder('ipv4first');
  const sdkPath = SDK_PATH;
  const sdk = await import(sdkPath) as { RocketRideClient: new (config: Record<string, unknown>) => CloudClient };
  const client = new sdk.RocketRideClient({ auth: env.key, uri: env.uri, env: {}, persist: false, requestTimeout: options.requestTimeout ?? 20000 });
  return { client, secrets: [env.key], host: new URL(env.uri).hostname };
}

// ---------- the bounded run ----------
export interface RunOptions { client?: CloudClient; secrets?: string[]; host?: string; now?: () => Date; taskName?: string; ttlSeconds?: number; onPrivate?: (record: Record<string, unknown>) => void }
function argumentFromError(message: string): string | null {
  const m = message.match(/(?:required (?:positional|keyword(?:-only)?) arguments?|missing[^'"]*):?\s*['"]([A-Za-z_]\w*)['"]/) ?? message.match(/unexpected keyword argument ['"]([A-Za-z_]\w*)['"]/);
  return m ? m[1] : null;
}
function taskSummary(status: Record<string, unknown> | null): CloudReceipt['task'] {
  if (!status) return null;
  const s = status as { state?: number; completed?: boolean; exitCode?: number; status?: string; startTime?: number; endTime?: number; tokens?: Record<string, number>; metrics?: unknown; errors?: unknown[]; warnings?: unknown[] };
  return { state: s.state, completed: s.completed, exitCode: s.exitCode, status: typeof s.status === 'string' ? s.status.slice(0, 200) : undefined, startTime: s.startTime, endTime: s.endTime, tokens: s.tokens, metrics: s.metrics, errors: Array.isArray(s.errors) ? s.errors.length : undefined, warnings: Array.isArray(s.warnings) ? s.warnings.length : undefined };
}
/**
 * Runs the order-review procedure in the RocketRide sandbox for one or more cases inside a single task,
 * compares each result with the local quote and writes a sanitized receipt to `${root}/receipts/<id>.json`.
 * Always terminates the task and disconnects, even on failure. Throws after writing the receipt when the
 * run failed or any case disagrees.
 */
export async function runCloudReview(root: string, company: CompanyData, cases: ReviewCase[], options: RunOptions = {}): Promise<{ receipt: CloudReceipt; proposals: SampleProposal[] }> {
  validateCompany(company);
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 3) throw new Error('Run 1–3 review cases per bounded RocketRide task.');
  for (const c of cases) validateReviewCase(c);
  // Generate every program first so an oversized or invalid input never claims a run slot or opens a connection.
  const prepared = cases.map(review => ({ review, local: localReference(company, review), program: orderReviewProgram(company, review) }));
  const now = options.now ?? (() => new Date());
  const allowance = await readAllowance(root); checkAllowance(allowance, now().getTime());
  await claimRun(root, allowance as CloudAllowance, now());
  const id = randomUUID(), startedAt = now().toISOString(), started = Date.now();
  const floor = (allowance as CloudAllowance).minAvailableCredits;
  const receipt: CloudReceipt = { id, engine: ENGINE, host: options.host ?? STAGING_HOST, projectId: PIPE_PROJECT_ID, source: PIPE_SOURCE, node: PYTHON_NODE, startedAt, finishedAt: startedAt, ms: 0, pipelineValidated: null, validationErrors: null, validationWarnings: null, taskTokenPrefix: null, taskTokenSha256: null, taskId: null, taskName: options.taskName ?? 'synth-order-review-cloud', terminated: false, task: null, credits: { unit: 'RocketRide credit units (API label: tokens)', floor, availableBefore: null, availableAfter: null, consumedBefore: null, consumedAfter: null, unitsUsed: null, attributedTransactions: null, ledgerNote: 'not read' }, cases: [], agrees: null, cloudModelCalls: 0, externalModelKeys: 0, paidCalls: 0 };
  const proposals: SampleProposal[] = [];
  let secrets = options.secrets ?? [], client = options.client, token: string | undefined, orgId: string | undefined, failure: unknown;
  const priv = (record: Record<string, unknown>) => { try { options.onPrivate?.(record); } catch { /* private capture is best-effort */ } };
  try {
    if (!client && (process.env.NODE_ENV === 'test' || process.env.ROCKETRIDE_NO_NETWORK === '1')) throw new Error('A real RocketRide client is never created under the test runner; inject a client.');
    if (!client) { const built = await createStagingClient(); client = built.client; secrets = built.secrets; receipt.host = built.host; }
    await client.connect();
    if (!client.isAuthenticated()) throw new Error('RocketRide staging did not authenticate the existing key.');
    // Fail closed on the live credit balance before validation or any task exists: billing must answer with a finite balance at or above the floor.
    if (!client.account || !client.billing) throw new Error('RocketRide billing is unavailable on this client; refusing to start a task without a live credit balance.');
    try { const org = await client.account.getOrg(); orgId = org.id ?? org.org?.id; } catch (e) { throw new Error(`RocketRide organization lookup failed; refusing to start a task: ${redact((e as Error).message, secrets).slice(0, 120)}`); }
    if (!orgId) throw new Error('RocketRide did not return an organization; refusing to start a task.');
    let balance: { balances: Record<string, number>; consumed: Record<string, number> };
    try { balance = await client.billing.getCreditBalance(orgId); } catch (e) { throw new Error(`RocketRide credit balance unavailable; refusing to start a task: ${redact((e as Error).message, secrets).slice(0, 120)}`); }
    const available = balance?.balances?.tokens, consumedBefore = balance?.consumed?.tokens;
    if (typeof available !== 'number' || !Number.isFinite(available)) throw new Error('RocketRide credit balance is not a finite number; refusing to start a task.');
    if (available < floor) throw new Error(`RocketRide available credits (${available}) are below the configured floor (${floor}); refusing to start a task.`);
    receipt.credits.availableBefore = available; receipt.credits.consumedBefore = typeof consumedBefore === 'number' && Number.isFinite(consumedBefore) ? consumedBefore : null; receipt.credits.ledgerNote = 'live balance verified against the floor before the task; read again after';
    const pipeline = buildOrderReviewPipeline();
    const validation = await client.validate({ pipeline, source: PIPE_SOURCE });
    receipt.pipelineValidated = validation.errors.length === 0; receipt.validationErrors = validation.errors.length; receipt.validationWarnings = validation.warnings.length;
    priv({ phase: 'validate', validation });
    if (validation.errors.length) throw new Error(`RocketRide rejected the pipeline: ${redact(JSON.stringify(validation.errors).slice(0, 300), secrets)}`);
    const use = await client.use({ pipeline, source: PIPE_SOURCE, ttl: options.ttlSeconds ?? 90, name: receipt.taskName, env: {} });
    token = use.token; const masked = maskToken(token); receipt.taskTokenPrefix = masked.prefix; receipt.taskTokenSha256 = masked.sha256; receipt.taskId = taskIdFromToken(token);
    priv({ phase: 'use', response: use });
    let tool = 'execute', argument = 'code', attemptsUsed = 0;
    for (const { review, local, program } of prepared) {
      const caseStarted = Date.now();
      const cr: CaseReceipt = { quantity: review.quantity, budgetCents: review.budgetCents, notesCount: review.notes.length, inputSha256: program.inputSha256, ms: 0, agrees: null, differences: [], cloudChosen: null, localChosen: local.chosen?.id ?? null, cloudOutput: null, localReference: local, attempts: [] };
      receipt.cases.push(cr);
      let output: CloudOutput | null = null;
      while (!output) {
        if (attemptsUsed >= MAX_TOOL_ATTEMPTS) throw new Error('The sandbox tool could not be invoked within the bounded attempt limit.');
        attemptsUsed++; const attemptStarted = Date.now();
        const response = await client.request(client.buildRequest('rrext_process', { arguments: { subcommand: 'tool', tool, nodeId: PYTHON_NODE, input: { [argument]: program.code } }, token }));
        priv({ phase: 'tool', tool, argument, response });
        if (client.didFail(response)) {
          const message = redact(response.message ?? 'Tool invocation failed.', secrets).slice(0, 300);
          cr.attempts.push({ tool, argument, ok: false, ms: Date.now() - attemptStarted, error: message });
          const renamed = argumentFromError(message);
          if (renamed && renamed !== argument) { argument = renamed; continue; }
          if (/no node|unknown tool|not found|does not (?:own|handle)|no tool/i.test(message) && tool === 'execute') { tool = 'python.execute'; continue; }
          throw new Error(`RocketRide sandbox call failed: ${message}`);
        }
        const outputs = extractCloudOutputs(response.body?.result ?? response.body);
        cr.attempts.push({ tool, argument, ok: true, ms: Date.now() - attemptStarted });
        if (outputs.length !== 1) throw new Error(`The sandbox returned ${outputs.length} order-review results instead of one.`);
        output = outputs[0];
      }
      if (output.inputSha256 !== program.inputSha256) throw new Error('The cloud result does not echo the input fingerprint.');
      cr.cloudOutput = output; cr.cloudChosen = output.proposal.chosen?.id ?? null;
      const comparison = compareProposals(local, output.proposal); cr.agrees = comparison.agrees; cr.differences = comparison.differences; cr.ms = Date.now() - caseStarted;
      proposals.push(output.proposal);
    }
    receipt.agrees = receipt.cases.every(c => c.agrees === true);
  } catch (error) { failure = error; receipt.failure = redact((error as Error).message, secrets).slice(0, 400); }
  finally {
    if (client && token) {
      try { const status = await client.getTaskStatus(token, { timeout: 15000 }); receipt.task = taskSummary(status); priv({ phase: 'status', status }); } catch (e) { priv({ phase: 'status-error', error: redact((e as Error).message, secrets) }); }
      try { const exported = await client.getTaskPipeline(token); priv({ phase: 'task-pipeline', pipeline: exported }); } catch (e) { priv({ phase: 'task-pipeline-error', error: redact((e as Error).message, secrets) }); }
      try { await client.terminate(token); receipt.terminated = true; } catch (e) { receipt.failure = `${receipt.failure ? receipt.failure + ' ' : ''}Task termination unconfirmed: ${redact((e as Error).message, secrets).slice(0, 120)}. The ${options.ttlSeconds ?? 90}s idle TTL is the fallback.`; if (!failure) failure = new Error(receipt.failure); }
      if (client.account && client.billing && receipt.credits.availableBefore !== null) {
        try {
          if (orgId) {
            const b = await client.billing.getCreditBalance(orgId); receipt.credits.availableAfter = b.balances?.tokens ?? null; receipt.credits.consumedAfter = b.consumed?.tokens ?? null;
            if (receipt.credits.consumedAfter !== null && receipt.credits.consumedBefore !== null) receipt.credits.unitsUsed = Math.round((receipt.credits.consumedAfter - receipt.credits.consumedBefore) * 1000) / 1000;
            try { const tx = await client.billing.getTransactions(orgId, { page: 1, pageSize: 25 }); const mine = tx.transactions.filter(t => ledgerRowBelongsToTask(t, token as string)); receipt.credits.attributedTransactions = mine.length; priv({ phase: 'transactions', attributed: mine, total: tx.total }); receipt.credits.ledgerNote = mine.length ? `live balance verified before the task; ${mine.length} ledger row(s) attributed to task ${receipt.taskId}` : 'live balance verified before the task; no task-attributed ledger row posted yet at read time'; }
            catch (e) { receipt.credits.ledgerNote = `transactions unavailable: ${redact((e as Error).message, secrets).slice(0, 120)}`; }
          }
        } catch (e) { receipt.credits.ledgerNote = `balance after unavailable: ${redact((e as Error).message, secrets).slice(0, 120)}`; }
      }
    }
    if (client) await client.disconnect().catch(() => { });
    receipt.finishedAt = now().toISOString(); receipt.ms = Date.now() - started;
    await mkdir(`${root}/receipts`, { recursive: true });
    const text = JSON.stringify(receipt, null, 2);
    if (secrets.some(s => s && text.includes(s)) || (token && text.includes(token))) throw new Error('Refusing to write a receipt that contains a credential or task token.');
    await writeFile(`${root}/receipts/${id}.json`, text + '\n', { mode: 0o600 });
  }
  if (failure) throw new Error(`${receipt.failure} Run ${id}.`);
  if (!receipt.agrees) throw new Error(`The RocketRide cloud replay disagrees with the local quote: ${receipt.cases.flatMap(c => c.differences).join('; ')}. Run ${id}.`);
  return { receipt, proposals };
}

/**
 * Coordinator hook: cross-check the current quote in the cloud when the bounded allowance is enabled.
 * Returns `{skipped:true}` when the allowance file is absent or disabled so the local flow continues unchanged.
 */
export async function cloudReviewCrossCheck(root: string, company: CompanyData, notes: string[], quantity: number, budgetCents: number, expected?: SampleProposal | null, options: RunOptions = {}): Promise<{ skipped: true; reason: string } | { skipped: false; agrees: boolean; receipt: CloudReceipt; proposal: SampleProposal }> {
  const allowance = await readAllowance(root);
  if (!allowance || !allowance.enabled) return { skipped: true, reason: 'RocketRide cloud review is not enabled.' };
  const { receipt, proposals } = await runCloudReview(root, company, [{ quantity, budgetCents, notes }], options);
  const proposal = proposals[0];
  const agrees = expected ? compareProposals(expected, proposal).agrees : receipt.agrees === true;
  return { skipped: false, agrees, receipt, proposal };
}

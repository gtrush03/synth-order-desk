// Isolated tests for the RocketRide cloud adapter. Run: bun test scripts/rocketride-cloud.test.ts
// No network, no credentials, no shared conversation state. Temporary files live under the RocketRide lane state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { buildOrderReviewPipeline, orderReviewProgram, localReference, extractCloudOutputs, compareProposals, canonical, loadStagingEnv, redact, maskToken, readAllowance, checkAllowance, claimRun, runCloudReview, cloudReviewCrossCheck, PIPE_SOURCE, PYTHON_NODE, RESULT_SENTINEL, type CloudClient, type DapResponse, type CloudAllowance, type ReviewCase } from '../src/rocketride-cloud.ts';
import { validateCompany, type CompanyData } from '../src/company-workspace.ts';

const run = promisify(execFile);
const project = resolve(import.meta.dirname, '..');
const base = process.env.TRU_TEST_RUNS ?? resolve(process.env.TRU_PLAN_OUTPUT ?? 'run', 'test-runs');
async function temporary() { await mkdir(base, { recursive: true }); return mkdtemp(`${base}/run-`); }
const company = async () => validateCompany(JSON.parse(await readFile(resolve(project, 'fixtures/company.json'), 'utf8')));
const allowance = (over: Partial<CloudAllowance> = {}): CloudAllowance => ({ enabled: true, host: 'staging.rocketride.ai', freeCreditConfirmed: true, minAvailableCredits: 1000, maxRuns: 3, validUntil: '2099-01-01T00:00:00Z', proof: 'evidence/rocketride-cloud-profile.json', ...over });
// The program is fed through stdin, not argv, so long inputs and quotes never touch the shell.
async function pythonStdin(code: string): Promise<string> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python3', ['-I', '-'], { stdio: ['pipe', 'pipe', 'pipe'] }); let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolvePromise(out) : reject(new Error(`python exited ${code}: ${err.slice(0, 500)}`)));
    child.stdin.end(code);
  });
}
void run;

test('the exported pipe is exactly the adapter definition: one tools source, one credential-free python sandbox, nothing else', async () => {
  const file = JSON.parse(await readFile(resolve(project, 'pipelines/order-review-cloud.pipe'), 'utf8'));
  const built = buildOrderReviewPipeline();
  assert.equal(canonical(file), canonical(built));
  assert.equal(built.source, PIPE_SOURCE);
  assert.equal(built.components.length, 2);
  const [source, sandbox] = built.components;
  assert.equal(source.provider, 'tools'); assert.equal(source.id, PIPE_SOURCE); assert.equal(source.config.type, 'tools'); assert.equal(source.config.mode, 'Source');
  assert.equal(sandbox.provider, 'tool_python'); assert.equal(sandbox.id, PYTHON_NODE);
  assert.deepEqual(sandbox.control, [{ classType: 'tool', from: PIPE_SOURCE }]);
  assert.deepEqual(sandbox.config, { type: 'tool_python', timeout: 20, allowedModules: [] });
  const text = JSON.stringify(built);
  assert.doesNotMatch(text, /llm_|agent_|mcp_client|apikey|api_key|secret|password|\$\{ROCKETRIDE_/i);
  assert.ok(built.components.every(c => !c.input), 'no data lanes are wired; the sandbox is called directly');
});

test('the sandbox program reproduces the local quote for a grid of quantities, budgets and shipment policies', async () => {
  const data = await company();
  const quantities = [1, 50, 100, 101, 140, 150, 200], budgets = [0, 115000, 163000, 175000, 180000, 200000, 1000000];
  const policies: string[][] = [[], ['Never split shipments.'], ['Never split shipments.', 'Split shipments are okay now.'], ["Don't use split for this customer", 'Ship before Friday'], ['single shipment only']];
  const cases: ReviewCase[] = [];
  for (const quantity of quantities) for (const budgetCents of budgets) for (const notes of policies) cases.push({ quantity, budgetCents, notes });
  const programs = cases.map(c => orderReviewProgram(data, c));
  assert.equal(new Set(programs.map(p => p.inputSha256)).size, cases.length, 'every case has a distinct input fingerprint');
  const stdout = await pythonStdin(programs.map(p => p.code).join('\n'));
  const outputs = extractCloudOutputs(stdout);
  assert.equal(outputs.length, cases.length);
  let disagreements = 0, splitAvoided = 0, infeasible = 0;
  outputs.forEach((output, i) => {
    assert.equal(output.inputSha256, programs[i].inputSha256);
    const local = localReference(data, cases[i]);
    const comparison = compareProposals(local, output.proposal);
    if (!comparison.agrees) { disagreements++; console.log('mismatch', cases[i], comparison.differences); }
    if (local.chosen === null) infeasible++;
    if (cases[i].notes.length && local.options.find(o => o.id === 'split')?.onTime && local.chosen?.id !== 'split') splitAvoided++;
  });
  assert.equal(disagreements, 0);
  assert.ok(infeasible > 0 && infeasible < cases.length, 'the grid covers both feasible and infeasible orders');
  assert.ok(splitAvoided > 0, 'the policy path changed the chosen option in at least one case');
  // Spot checks against the verified event numbers.
  const at = (q: number, b: number, n: string[]) => outputs[cases.findIndex(c => c.quantity === q && c.budgetCents === b && canonical(c.notes) === canonical(n))].proposal;
  assert.equal(at(150, 180000, []).chosen?.totalCents, 175000);
  assert.equal(at(140, 180000, []).chosen?.totalCents, 163000);
  assert.equal(at(100, 180000, []).chosen?.totalCents, 115000);
  // Under the never-split rule express is the only on-time option: $1,950 for 150 shirts, so the $1,800 budget is infeasible and $2,000 selects express.
  assert.equal(at(150, 180000, ['Never split shipments.']).chosen, null);
  assert.equal(at(150, 200000, ['Never split shipments.']).chosen?.id, 'express');
  assert.equal(at(150, 200000, ['Never split shipments.']).chosen?.totalCents, 195000);
  assert.equal(at(150, 200000, ['Never split shipments.', 'Split shipments are okay now.']).chosen?.id, 'split');
});

test('hostile company text is embedded verbatim and cannot smuggle substitution placeholders or break the program', async () => {
  const data = await company();
  const hostileId = ['demo"', "\\'", '""', '   ${NOT_ROCKETRIDE} ', "'''", ' """ 😀 é'].join('');
  const hostile: CompanyData = { ...data, id: hostileId, name: 'Quote " and \\ backslash\nnewline' };
  const review: ReviewCase = { quantity: 120, budgetCents: 180000, notes: ['Keep it "simple" \\ \'ok\' 😀', 'Never split shipments.'] };
  const program = orderReviewProgram(hostile, review);
  assert.doesNotMatch(program.code, /[^\x00-\x7f]/, 'the embedded input is pure ASCII');
  const [output] = extractCloudOutputs(await pythonStdin(program.code));
  assert.equal(output.proposal.options[0].explanation, `120 units + shipping; company source ${hostile.id}`);
  assert.equal(compareProposals(localReference(hostile, review), output.proposal).agrees, true);
  assert.throws(() => orderReviewProgram(data, { quantity: 10, budgetCents: 1000, notes: ['use ${ROCKETRIDE_APIKEY} please'] }), /substitution placeholders/);
  assert.throws(() => orderReviewProgram(data, { quantity: 0, budgetCents: 1000, notes: [] }), /1 to 200/);
  assert.throws(() => orderReviewProgram(data, { quantity: 10, budgetCents: 12.5, notes: [] }), /two decimal places/);
  assert.throws(() => orderReviewProgram({ ...data, shipping: data.shipping.slice(0, 2) } as CompanyData, review), /Invalid company/);
});

test('cloud output extraction accepts the sandbox return shapes and rejects everything else', () => {
  const data = { procedure: 'order-review', version: '1.0.0', engine: 'x', inputSha256: 'abc', proposal: { quantity: 1, budgetCents: 1, options: [], chosen: null }, approved: false, cloudModelCalls: 0 };
  const line = RESULT_SENTINEL + JSON.stringify(data);
  assert.equal(extractCloudOutputs(`noise\n${line}\n`).length, 1);
  assert.equal(extractCloudOutputs({ stdout: `${line}\n`, stderr: '' }).length, 1);
  assert.equal(extractCloudOutputs({ result: { output: data } }).length, 1);
  assert.equal(extractCloudOutputs(data).length, 1);
  assert.equal(extractCloudOutputs({ stdout: `${line}\n${line}` }).length, 1, 'identical copies collapse');
  // The actual staging sandbox shape observed on 2026-09-11: stdout with the sentinel line plus the structured `result` variable.
  assert.equal(extractCloudOutputs({ stdout: `${line}\n`, stderr: '', exit_code: 0, timed_out: false, result: data }).length, 1);
  const other = { ...data, inputSha256: 'def' };
  assert.equal(extractCloudOutputs({ stdout: `${line}\n`, result: other }).length, 2, 'different results stay distinct');
  assert.equal(extractCloudOutputs({ stdout: RESULT_SENTINEL + '{"procedure":"order-review"}' }).length, 0, 'a result without the full contract is ignored');
  assert.equal(extractCloudOutputs({ ...data, approved: true }).length, 0, 'an approved flag from the cloud is never accepted');
  assert.equal(extractCloudOutputs({ ...data, cloudModelCalls: 1 }).length, 0);
  assert.equal(extractCloudOutputs('SYNTH_RESULT:not json').length, 0);
  assert.equal(extractCloudOutputs(null).length, 0);
});

test('proposal comparison ignores key order but reports every money, date or choice difference', async () => {
  const data = await company();
  const local = localReference(data, { quantity: 150, budgetCents: 180000, notes: [] });
  const reordered = JSON.parse(JSON.stringify({ chosen: local.chosen, options: local.options.map(o => ({ withinBudget: o.withinBudget, explanation: o.explanation, onTime: o.onTime, arrival: o.arrival, totalCents: o.totalCents, name: o.name, id: o.id })), budgetCents: local.budgetCents, quantity: local.quantity }));
  assert.equal(compareProposals(local, reordered).agrees, true);
  const cheaper = structuredClone(local); cheaper.options[2].totalCents -= 100; cheaper.chosen = cheaper.options[2];
  const diff = compareProposals(local, cheaper);
  assert.equal(diff.agrees, false); assert.match(diff.differences.join(' '), /option split/); assert.match(diff.differences.join(' '), /chosen/);
  const late = structuredClone(local); late.options[1].arrival = '2026-09-25';
  assert.match(compareProposals(local, late).differences.join(' '), /option express/);
  assert.equal(compareProposals(local, { quantity: 150 }).agrees, false);
});

test('credential loading accepts only the existing staging pair and redaction hides keys, JWTs and bearer tokens', async () => {
  const dir = await temporary();
  await writeFile(`${dir}/ok.env`, '# comment\nexport ROCKETRIDE_URI="https://staging.rocketride.ai"\nROCKETRIDE_APIKEY=example-key-value-1234\nROCKETRIDE_ANTHROPIC_KEY=must-not-load\nOPENAI_API_KEY=nope\n');
  const env = await loadStagingEnv(`${dir}/ok.env`);
  assert.deepEqual(env, { uri: 'https://staging.rocketride.ai', key: 'example-key-value-1234' });
  await writeFile(`${dir}/cloud.env`, 'ROCKETRIDE_URI=https://cloud.rocketride.ai\nROCKETRIDE_APIKEY=example-key-value-1234\n');
  await assert.rejects(loadStagingEnv(`${dir}/cloud.env`), /Only staging\.rocketride\.ai/);
  await writeFile(`${dir}/missing.env`, 'ROCKETRIDE_URI=https://staging.rocketride.ai\n');
  await assert.rejects(loadStagingEnv(`${dir}/missing.env`), /not found/);
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnopqrstuvwxyz012345'].join('.'); // synthetic, built at runtime
  const text = redact(`key example-key-value-1234 token ${jwt} Authorization: Bearer abcdefghijklmnopqrstuvwxyz`, ['example-key-value-1234']);
  assert.doesNotMatch(text, /example-key-value-1234|eyJ|abcdefghijklmnopqrstuvwxyz$/);
  assert.equal(redact('short', ['abc']), 'short', 'tiny secrets are not used as redaction patterns');
  const masked = maskToken('task-token-0123456789');
  assert.equal(masked.prefix, 'task-t'); assert.equal(masked.sha256.length, 64);
});

test('the bounded allowance refuses disabled, foreign-host, unverified, expired or exhausted runs and counts failed runs', async () => {
  const dir = await temporary();
  assert.equal(await readAllowance(dir), null);
  assert.throws(() => checkAllowance(null), /not enabled/);
  assert.throws(() => checkAllowance(allowance({ enabled: false })), /not enabled/);
  assert.throws(() => checkAllowance(allowance({ host: 'cloud.rocketride.ai' })), /host must be/);
  assert.throws(() => checkAllowance(allowance({ freeCreditConfirmed: false })), /verified free-credit profile/);
  assert.throws(() => checkAllowance(allowance({ proof: '' })), /verified free-credit profile/);
  assert.throws(() => checkAllowance(allowance({ minAvailableCredits: 10 })), /at least 100/);
  assert.throws(() => checkAllowance(allowance({ maxRuns: 50 })), /1–20/);
  assert.throws(() => checkAllowance(allowance({ validUntil: '2026-09-11T00:00:00Z' }), Date.parse('2026-09-11T00:00:01Z')), /expired/);
  checkAllowance(allowance(), Date.parse('2026-09-11T20:00:00Z'));
  await writeFile(`${dir}/rocketride-allowance.json`, 'not json');
  await assert.rejects(readAllowance(dir), /invalid/);
  await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance({ maxRuns: 2 })));
  assert.equal(await claimRun(dir, allowance({ maxRuns: 2 })), 1);
  assert.equal(await claimRun(dir, allowance({ maxRuns: 2 })), 2);
  await assert.rejects(claimRun(dir, allowance({ maxRuns: 2 })), /exhausted/);
  assert.equal(JSON.parse(await readFile(`${dir}/rocketride-run-count.json`, 'utf8')).used, 2);
});

interface FakeOptions { failTool?: (attempt: number, tool: string, argument: string) => string | null; resultShape?: (line: string) => unknown; validationErrors?: unknown[]; statusFails?: boolean; balance?: [number, number]; consumed?: [number, number]; balanceNull?: boolean; billingThrows?: boolean; noBilling?: boolean }
function fakeClient(options: FakeOptions = {}) {
  const calls: string[] = []; let attempt = 0, balanceReads = 0; const token = 'task-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const client: CloudClient = {
    async connect() { calls.push('connect'); }, async disconnect() { calls.push('disconnect'); }, isAuthenticated: () => true,
    async validate() { calls.push('validate'); return { errors: options.validationErrors ?? [], warnings: [] }; },
    async use(o) { calls.push(`use:${o.source}:${o.ttl}`); return { token }; },
    buildRequest: (command, o) => ({ type: 'request', command, arguments: { ...o.arguments, token: o.token } }),
    async request(message): Promise<DapResponse> {
      const args = message.arguments as { subcommand: string; tool: string; nodeId: string; input: Record<string, string>; token: string };
      calls.push(`tool:${args.tool}:${Object.keys(args.input)[0]}:${args.nodeId}`); attempt++;
      assert.equal(args.token, token); assert.equal(args.subcommand, 'tool');
      const failure = options.failTool?.(attempt, args.tool, Object.keys(args.input)[0]) ?? null;
      if (failure) return { success: false, message: failure };
      const code = Object.values(args.input)[0]; const line = (await pythonStdin(code)).trim();
      return { success: true, body: { result: options.resultShape ? options.resultShape(line) : { stdout: line + '\n' } } };
    },
    didFail: r => r.success === false,
    async getTaskStatus() { calls.push('status'); if (options.statusFails) throw new Error('status unavailable'); return { state: 5, completed: true, exitCode: 0, status: 'done', tokens: { cpu_utilization: 0.4, cpu_memory: 0.1 }, errors: [], warnings: [] }; },
    async getTaskPipeline() { calls.push('task-pipeline'); return buildOrderReviewPipeline() as unknown as Record<string, unknown>; },
    async terminate(t) { calls.push('terminate'); assert.equal(t, token); },
    account: options.noBilling ? undefined : { async getOrg() { calls.push('org'); return { id: 'org-1' }; } },
    billing: options.noBilling ? undefined : { async getCreditBalance() { calls.push('balance'); balanceReads++; if (options.billingThrows) throw new Error('ledger service timeout'); if (options.balanceNull) return { balances: {} as Record<string, number>, granted: {} as Record<string, number>, consumed: {} as Record<string, number> }; const [before, after] = options.balance ?? [4841.3, 4840.8]; const [cb, ca] = options.consumed ?? [158.7, 159.2]; return balanceReads === 1 ? { balances: { tokens: before }, granted: { tokens: 5000 }, consumed: { tokens: cb } } : { balances: { tokens: after }, granted: { tokens: 5000 }, consumed: { tokens: ca } }; }, async getTransactions() { return { transactions: [{ idempotencyKey: `task:${token}:cpu_utilization`, resource: 'cpu_utilization', amount: -0.5 }, { idempotencyKey: 'task:other:cpu_utilization', amount: -1, context: { task_id: 'zzzzzzzz.tools_1' } }, { idempotencyKey: 'task:opaque:cpu_memory', amount: -0.1, context: { task_id: 'task-tok.tools_1', pipeline: 'synth-order-review-cloud' } }], total: 3 }; } }
  };
  return { client, calls, token };
}

test('a bounded run validates, starts one task, calls the sandbox once per case, compares, terminates and writes a token-free receipt', async () => {
  const dir = await temporary(); await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance()));
  const data = await company(); const fake = fakeClient(); const privateRecords: Record<string, unknown>[] = [];
  const { receipt, proposals } = await runCloudReview(dir, data, [{ quantity: 150, budgetCents: 180000, notes: [] }, { quantity: 150, budgetCents: 200000, notes: ['Never split shipments.'] }], { client: fake.client, secrets: ['example-secret-value'], host: 'staging.rocketride.ai', onPrivate: r => privateRecords.push(r) });
  assert.deepEqual(fake.calls, ['connect', 'org', 'balance', 'validate', 'use:tools_1:90', 'tool:execute:code:tool_python_1', 'tool:execute:code:tool_python_1', 'status', 'task-pipeline', 'terminate', 'balance', 'disconnect']);
  assert.equal(receipt.agrees, true); assert.equal(receipt.terminated, true); assert.equal(receipt.pipelineValidated, true);
  assert.equal(proposals[0].chosen?.id, 'split'); assert.equal(proposals[1].chosen?.id, 'express');
  assert.equal(receipt.cases[1].cloudChosen, 'express'); assert.equal(receipt.cases[1].localChosen, 'express');
  assert.equal(receipt.taskTokenPrefix, 'task-t'); assert.equal(receipt.taskTokenSha256?.length, 64);
  assert.equal(receipt.credits.unitsUsed, 0.5); assert.equal(receipt.credits.attributedTransactions, 2, 'rows match by token or by the 8-character task id in ledger context'); assert.equal(receipt.credits.floor, 1000); assert.equal(receipt.taskId, 'task-tok'); assert.equal(receipt.task?.exitCode, 0);
  assert.equal(receipt.cloudModelCalls, 0); assert.equal(receipt.externalModelKeys, 0); assert.equal(receipt.paidCalls, 0);
  const saved = await readFile(`${dir}/receipts/${receipt.id}.json`, 'utf8');
  assert.ok(!saved.includes(fake.token), 'the task token is never written to the receipt'); assert.ok(!saved.includes('example-secret-value'));
  assert.equal((await stat(`${dir}/receipts/${receipt.id}.json`)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(`${dir}/rocketride-run-count.json`, 'utf8')).used, 1);
  assert.ok(privateRecords.some(r => r.phase === 'use') && privateRecords.some(r => r.phase === 'task-pipeline'), 'private capture receives the raw task and exported pipeline');
});

test('the adapter learns the sandbox argument name and tool name from the error text within the attempt limit', async () => {
  const dir = await temporary(); await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance()));
  const data = await company();
  const learning = fakeClient({ failTool: (attempt, tool, argument) => attempt === 1 ? 'No node handles tool "execute"' : attempt === 2 && tool === 'python.execute' && argument === 'code' ? "execute() missing 1 required positional argument: 'script'" : null });
  const { receipt } = await runCloudReview(dir, data, [{ quantity: 100, budgetCents: 180000, notes: [] }], { client: learning.client });
  assert.deepEqual(learning.calls.filter(c => c.startsWith('tool:')), ['tool:execute:code:tool_python_1', 'tool:python.execute:code:tool_python_1', 'tool:python.execute:script:tool_python_1']);
  assert.equal(receipt.cases[0].attempts.length, 3); assert.equal(receipt.cases[0].attempts[2].ok, true); assert.equal(receipt.agrees, true);
  const stubborn = fakeClient({ failTool: () => 'Sandbox disabled for this account' });
  await assert.rejects(runCloudReview(dir, data, [{ quantity: 100, budgetCents: 180000, notes: [] }], { client: stubborn.client }), /Sandbox disabled/);
  assert.ok(stubborn.calls.includes('terminate') && stubborn.calls.includes('disconnect'), 'failure still terminates the task and disconnects');
  assert.equal(JSON.parse(await readFile(`${dir}/rocketride-run-count.json`, 'utf8')).used, 2, 'the failed run consumed an allowance slot');
});

test('a cloud quote that disagrees with the local quote is rejected with the receipt kept, and other failure paths stay clean', async () => {
  const dir = await temporary(); await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance({ maxRuns: 5 })));
  const data = await company();
  const tampered = fakeClient({ resultShape: line => ({ stdout: line.replace('"totalCents":175000', '"totalCents":174000') + '\n' }) });
  await assert.rejects(runCloudReview(dir, data, [{ quantity: 150, budgetCents: 180000, notes: [] }], { client: tampered.client }), /disagrees with the local quote.*option split/);
  const receipts = (await import('node:fs/promises')).readdir(`${dir}/receipts`); assert.equal((await receipts).length, 1);
  const twice = fakeClient({ resultShape: line => ({ stdout: `${line}\n${line.replace('"inputSha256":"', '"inputSha256":"tampered-')}\n` }) });
  await assert.rejects(runCloudReview(dir, data, [{ quantity: 150, budgetCents: 180000, notes: [] }], { client: twice.client }), /2 order-review results/);
  const invalid = fakeClient({ validationErrors: [{ message: 'bad node' }] });
  await assert.rejects(runCloudReview(dir, data, [{ quantity: 150, budgetCents: 180000, notes: [] }], { client: invalid.client }), /rejected the pipeline/);
  assert.ok(!invalid.calls.some(c => c.startsWith('use:')), 'no task starts after a validation error');
  const quiet = fakeClient({ statusFails: true });
  const { receipt } = await runCloudReview(dir, data, [{ quantity: 150, budgetCents: 180000, notes: [] }], { client: quiet.client });
  assert.equal(receipt.task, null); assert.equal(receipt.terminated, true);
  await assert.rejects(runCloudReview(dir, data, [], { client: quiet.client }), /1–3 review cases/);
});

test('the live balance floor fails closed before validation or any task: zero, below floor, non-finite, unavailable or missing billing', async () => {
  const dir = await temporary(); await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance({ maxRuns: 10 })));
  const data = await company(); const one = [{ quantity: 150, budgetCents: 180000, notes: [] }];
  const scenarios: [string, ReturnType<typeof fakeClient>, RegExp][] = [
    ['zero balance', fakeClient({ balance: [0, 0] }), /below the configured floor/],
    ['below floor', fakeClient({ balance: [999.9, 999.9] }), /below the configured floor/],
    ['non-finite balance', fakeClient({ balanceNull: true }), /not a finite number/],
    ['billing read fails', fakeClient({ billingThrows: true }), /credit balance unavailable/],
    ['no billing namespace', fakeClient({ noBilling: true }), /billing is unavailable/]
  ];
  for (const [label, fake, pattern] of scenarios) {
    await assert.rejects(runCloudReview(dir, data, one, { client: fake.client }), pattern, label);
    assert.ok(!fake.calls.some(c => c === 'validate' || c.startsWith('use:') || c.startsWith('tool:')), `${label}: nothing validated, no task started, no sandbox call`);
    assert.ok(!fake.calls.includes('terminate') && fake.calls.includes('disconnect'), `${label}: nothing to terminate, connection closed`);
  }
  const positive = fakeClient({ balance: [1000, 999.5], consumed: [100, 100.5] });
  const { receipt } = await runCloudReview(dir, data, one, { client: positive.client });
  assert.equal(receipt.credits.floor, 1000); assert.equal(receipt.credits.availableBefore, 1000, 'a balance exactly at the floor is allowed'); assert.equal(receipt.credits.unitsUsed, 0.5);
  assert.ok(positive.calls.indexOf('balance') < positive.calls.indexOf('validate') && positive.calls.indexOf('validate') < positive.calls.indexOf('use:tools_1:90'), 'balance is verified before validation and before the task');
  assert.equal(JSON.parse(await readFile(`${dir}/rocketride-run-count.json`, 'utf8')).used, 6, 'refused runs still consume allowance slots');
});

test('oversized company input is rejected before a run slot is claimed or a connection opens', async () => {
  const dir = await temporary(); await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance()));
  const data = await company(); const huge: CompanyData = { ...data, source: 'x'.repeat(30000) };
  assert.throws(() => orderReviewProgram(huge, { quantity: 10, budgetCents: 1000, notes: [] }), /25 KB/);
  const fake = fakeClient();
  await assert.rejects(runCloudReview(dir, huge, [{ quantity: 10, budgetCents: 1000, notes: [] }], { client: fake.client }), /25 KB/);
  assert.deepEqual(fake.calls, [], 'no connection was opened');
  await assert.rejects(readFile(`${dir}/rocketride-run-count.json`, 'utf8'), /ENOENT/, 'no run slot was claimed');
});

test('the coordinator hook skips silently without an allowance and cross-checks the expected proposal with one', async () => {
  const dir = await temporary(); const data = await company();
  const skipped = await cloudReviewCrossCheck(dir, data, [], 150, 180000, null);
  assert.deepEqual(skipped, { skipped: true, reason: 'RocketRide cloud review is not enabled.' });
  await writeFile(`${dir}/rocketride-allowance.json`, JSON.stringify(allowance()));
  const fake = fakeClient();
  const expected = localReference(data, { quantity: 150, budgetCents: 180000, notes: [] });
  const checked = await cloudReviewCrossCheck(dir, data, [], 150, 180000, expected, { client: fake.client });
  assert.equal(checked.skipped, false);
  if (checked.skipped) return;
  assert.equal(checked.agrees, true); assert.equal(checked.proposal.chosen?.totalCents, 175000); assert.equal(checked.receipt.cases.length, 1);
  const stale = structuredClone(expected); stale.chosen!.totalCents = 174000;
  const mismatch = await cloudReviewCrossCheck(dir, data, [], 150, 180000, stale, { client: fakeClient().client });
  assert.equal(mismatch.skipped, false); if (!mismatch.skipped) assert.equal(mismatch.agrees, false, 'a stale local proposal is caught even when the cloud run itself agrees with fresh math');
  assert.ok(fake.calls.includes('terminate') && fake.calls.at(-1) === 'disconnect', 'the hook run terminated its task and closed the connection');
});

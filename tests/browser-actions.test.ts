// Pure tests for the bounded browser action. No browser, no network: the DevTools endpoint, the tab and the page
// are faked in-process. Run: bun test tests/browser-actions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import { readSupplierPage, webSocketSession, composeInquiryDraft, resolveSupplierPage, sameSite, SUPPLIER_PAGES, PAGE_FACTS_EXPRESSION, LOCATION_EXPRESSION, TEXT_EXCERPT_CHARS, type CdpSession } from '../src/browser-actions.ts';

const base = process.env.TRU_TEST_RUNS ?? `${process.cwd()}/run/test-runs`;
async function temporary() { await mkdir(base, { recursive: true }); return mkdtemp(`${base}/browser-`); }
const TARGET = SUPPLIER_PAGES['printful-tshirts'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface FakeOptions { navigateError?: string; neverLoads?: boolean; finalUrl?: string; evaluateThrows?: boolean; longText?: boolean; closeFails?: boolean; versionStalls?: boolean; closeStalls?: boolean; sessionStalls?: boolean; movesDuringRead?: string }
const never = (init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
function fakeBridge(options: FakeOptions = {}) {
  const urls: string[] = []; const calls: string[] = []; let closedTab: string | null = null; let privateReads = 0; let handler: ((m: string, p: Record<string, unknown>) => void) | null = null;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); urls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/json/version')) { if (options.versionStalls) return never(init); return new Response(JSON.stringify({ Browser: 'Chrome/152.0.7977.83', 'Protocol-Version': '1.3' }), { status: 200 }); }
    if (url.includes('/json/new')) return new Response(JSON.stringify({ id: 'TAB123456789', webSocketDebuggerUrl: 'ws://127.0.0.1:9876/devtools/page/TAB123456789' }), { status: 200 });
    if (url.includes('/json/close/')) { closedTab = url.split('/json/close/')[1]; if (options.closeStalls) return never(init); return new Response('Target is closing', { status: options.closeFails ? 500 : 200 }); }
    if (url.includes('/json/list')) throw new Error('other tabs must never be listed');
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const finalUrl = options.finalUrl ?? TARGET.url;
  const session = async (wsUrl: string): Promise<CdpSession> => {
    calls.push(`open ${wsUrl}`);
    if (options.sessionStalls) return new Promise<CdpSession>(() => { });
    return {
      async send(method, params = {}) {
        calls.push(method + (method === 'Page.navigate' ? ` ${params.url}` : ''));
        if (method === 'Page.navigate') {
          if (options.navigateError) return { errorText: options.navigateError };
          if (!options.neverLoads) queueMicrotask(() => { handler?.('Network.responseReceived', { type: 'Document', response: { status: 200, url: finalUrl } }); handler?.('Page.frameNavigated', { frame: { id: 'F1', url: finalUrl } }); handler?.('Page.frameNavigated', { frame: { id: 'F2', parentId: 'F1', url: 'https://ads.example.net/frame' } }); handler?.('Page.loadEventFired', { timestamp: 1 }); });
          return { frameId: 'F1', loaderId: 'L1' };
        }
        if (method === 'Runtime.evaluate' && params.expression === LOCATION_EXPRESSION) { calls[calls.length - 1] = 'Runtime.evaluate(location)'; return { result: { type: 'string', value: finalUrl } }; }
        if (method === 'Runtime.evaluate') {
          calls[calls.length - 1] = 'Runtime.evaluate(facts)'; privateReads++;
          if (options.evaluateThrows) return { exceptionDetails: { text: 'boom' } };
          assert.equal(params.expression, PAGE_FACTS_EXPRESSION, 'only the fixed reviewed expression is ever evaluated');
          if (options.movesDuringRead) return { result: { type: 'object', value: { title: 'PRIVATE', url: options.movesDuringRead, text: 'PRIVATE OFF-SITE TEXT', headings: ['PRIVATE'] } } };
          return { result: { type: 'object', value: { title: '  Custom Men’s T-Shirts \u0000| Printful ', url: finalUrl, text: options.longText ? 'x'.repeat(5000) : 'Unisex Staple T-Shirt\n\n  from $9.25  ', headings: ['Custom T-shirts', ' Popular products ', '', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'] } } };
        }
        if (method === 'Page.captureScreenshot') return { data: PNG.toString('base64') };
        return {};
      },
      onEvent(h) { handler = h; },
      close() { calls.push('close'); }
    };
  };
  return { fetchImpl, session, urls, calls, closedTab: () => closedTab, privateReads: () => privateReads };
}

test('the allowlist, loopback bridge and page-script guards cannot be widened by options', () => {
  assert.throws(() => resolveSupplierPage('https://evil.example'), /fixed allowlist/);
  assert.throws(() => resolveSupplierPage(undefined), /fixed allowlist/);
  assert.equal(resolveSupplierPage('printful-tshirts').url, 'https://www.printful.com/custom/mens/t-shirts');
  for (const page of Object.values(SUPPLIER_PAGES)) assert.match(page.url, /^https:\/\/www\.printful\.com\//);
  assert.doesNotMatch(PAGE_FACTS_EXPRESSION, /cookie|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|submit|click|location\.(assign|replace|href\s*=)/);
  assert.ok(sameSite('https://www.printful.com/x', TARGET.url) && sameSite('https://printful.com/', TARGET.url) && sameSite('https://eu.printful.com/', TARGET.url));
  assert.ok(!sameSite('http://www.printful.com/x', TARGET.url) && !sameSite('https://printful.com.evil.example/', TARGET.url) && !sameSite('https://accounts.google.com/', TARGET.url) && !sameSite('nonsense', TARGET.url));
});

test('bridge address must be the local loopback DevTools endpoint and an unknown target is refused before any request', async () => {
  const fake = fakeBridge();
  await assert.rejects(readSupplierPage({ cdpBase: 'http://10.0.0.5:9876', fetchImpl: fake.fetchImpl, session: fake.session }), /local loopback/);
  await assert.rejects(readSupplierPage({ cdpBase: 'https://127.0.0.1:9876', fetchImpl: fake.fetchImpl, session: fake.session }), /local loopback/);
  await assert.rejects(readSupplierPage({ target: 'https://evil.example' as never, fetchImpl: fake.fetchImpl, session: fake.session }), /fixed allowlist/);
  assert.deepEqual(fake.urls, [], 'nothing was requested');
});

test('a read opens exactly one own tab, navigates only to the allowlisted URL, reads with the fixed script, screenshots, closes that tab and writes a token-free receipt', async () => {
  const dir = await temporary(); const fake = fakeBridge(); const progress: string[] = [];
  const receipt = await readSupplierPage({ fetchImpl: fake.fetchImpl, session: fake.session, screenshotDir: `${dir}/shots`, receiptDir: `${dir}/receipts`, viewport: { width: 1280, height: 800 }, progress: (s, d) => progress.push(`${s}: ${d}`) });
  assert.equal(receipt.outcome, 'read'); assert.equal(receipt.failure, undefined);
  assert.deepEqual(fake.urls, ['GET http://127.0.0.1:9876/json/version', 'PUT http://127.0.0.1:9876/json/new?about:blank', 'GET http://127.0.0.1:9876/json/close/TAB123456789']);
  assert.deepEqual(fake.calls, ['open ws://127.0.0.1:9876/devtools/page/TAB123456789', 'Page.enable', 'Runtime.enable', 'Network.enable', 'Fetch.enable', 'Emulation.setDeviceMetricsOverride', `Page.navigate ${TARGET.url}`, 'Runtime.evaluate(location)', 'Runtime.evaluate(facts)', 'Page.captureScreenshot', 'Runtime.evaluate(location)', 'close']);
  assert.equal(fake.closedTab(), 'TAB123456789'); assert.equal(receipt.tab.closed, true); assert.equal(receipt.tab.targetIdPrefix, 'TAB12345'); assert.equal(receipt.tab.createdByThisAction, true);
  assert.equal(receipt.browser.version, 'Chrome/152.0.7977.83'); assert.equal(receipt.browser.cdpHost, '127.0.0.1:9876');
  assert.equal(receipt.page.httpStatus, 200); assert.equal(receipt.page.finalUrl, TARGET.url); assert.equal(receipt.page.sameSite, true);
  assert.equal(receipt.page.title, 'Custom Men’s T-Shirts | Printful', 'control characters and padding are removed');
  assert.deepEqual(receipt.page.headings, ['Custom T-shirts', 'Popular products', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'], 'empty headings dropped, at most eight kept');
  assert.equal(receipt.page.textExcerpt, 'Unisex Staple T-Shirt from $9.25'); assert.equal(receipt.page.excerptChars, 32);
  assert.deepEqual(receipt.page.mainFrameNavigations, [TARGET.url], 'child frames are not counted as navigations');
  assert.deepEqual(receipt.guards, { cookiesRead: false, storageRead: false, otherTabsInspected: false, formsSubmitted: false, clicks: 0, javascriptFromUser: false, browserClosed: false, navigationsBeyondTarget: 0 });
  assert.ok(receipt.screenshot && receipt.screenshot.bytes === PNG.length && receipt.screenshot.sha256.length === 64);
  assert.equal((await stat(receipt.screenshot!.path)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(`${dir}/receipts/${receipt.id}.json`, 'utf8')); assert.equal(saved.outcome, 'read'); assert.equal((await stat(`${dir}/receipts/${receipt.id}.json`)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(saved).includes('devtools/page'), 'the tab WebSocket address is not recorded');
  assert.deepEqual(progress.map(p => p.split(':')[0]), ['running', 'complete']); assert.match(progress[1], /nothing submitted or sent/);
  assert.ok(typeof receipt.ms === 'number' && receipt.startedAt <= receipt.finishedAt);
});

test('a page that leaves the allowed site is blocked before any title, heading or text is read', async () => {
  const fake = fakeBridge({ finalUrl: 'https://accounts.google.com/signin' });
  const receipt = await readSupplierPage({ fetchImpl: fake.fetchImpl, session: fake.session, screenshotDir: '/nonexistent/never-used' });
  assert.equal(receipt.outcome, 'blocked'); assert.match(receipt.failure ?? '', /left the allowed site; nothing on the other site was read/);
  assert.equal(fake.privateReads(), 0, 'the facts script never ran on the off-site page'); assert.ok(fake.calls.includes('Runtime.evaluate(location)') && !fake.calls.includes('Runtime.evaluate(facts)'));
  assert.equal(receipt.page.title, null); assert.equal(receipt.page.textExcerpt, null); assert.deepEqual(receipt.page.headings, []); assert.equal(receipt.screenshot, null);
  assert.equal(receipt.page.sameSite, false); assert.equal(receipt.page.finalUrl, 'https://accounts.google.com/signin'); assert.equal(receipt.guards.navigationsBeyondTarget, 1);
  assert.ok(!fake.calls.includes('Page.captureScreenshot')); assert.equal(fake.closedTab(), 'TAB123456789'); assert.equal(receipt.tab.closed, true);
  const moved = fakeBridge({ movesDuringRead: 'https://offsite.invalid/private' });
  const r2 = await readSupplierPage({ fetchImpl: moved.fetchImpl, session: moved.session });
  assert.equal(r2.outcome, 'blocked'); assert.match(r2.failure ?? '', /moved off the allowed site while being read/);
  assert.equal(r2.page.title, null); assert.equal(r2.page.textExcerpt, null); assert.deepEqual(r2.page.headings, []); assert.equal(r2.page.finalUrl, 'https://offsite.invalid/private'); assert.equal(r2.page.sameSite, false);
});

test('one total deadline bounds the bridge handshake, the session open and the tab cleanup, without unhandled rejections', async () => {
  const unhandled: unknown[] = []; const onUnhandled = (reason: unknown) => unhandled.push(reason); process.on('unhandledRejection', onUnhandled);
  try {
    const stalled = fakeBridge({ versionStalls: true }); const t0 = Date.now();
    const r1 = await readSupplierPage({ fetchImpl: stalled.fetchImpl, session: stalled.session, timeoutMs: 30 });
    assert.ok(Date.now() - t0 < 1000, 'the stalled handshake is cut at the deadline'); assert.equal(r1.outcome, 'error'); assert.match(r1.failure ?? '', /did not finish within/);
    assert.deepEqual(stalled.urls, ['GET http://127.0.0.1:9876/json/version']); assert.equal(r1.tab.targetIdPrefix, null, 'no tab was created');
    const noSession = fakeBridge({ sessionStalls: true }); const t1 = Date.now();
    const r2 = await readSupplierPage({ fetchImpl: noSession.fetchImpl, session: noSession.session, timeoutMs: 30 });
    assert.ok(Date.now() - t1 < 1000); assert.equal(r2.outcome, 'error'); assert.equal(noSession.closedTab(), 'TAB123456789', 'the tab that was created is still released');
    const stuckClose = fakeBridge({ closeStalls: true }); const t2 = Date.now();
    const r3 = await readSupplierPage({ fetchImpl: stuckClose.fetchImpl, session: stuckClose.session, cleanupTimeoutMs: 30 });
    assert.ok(Date.now() - t2 < 1000, 'cleanup is bounded on its own'); assert.equal(r3.outcome, 'read'); assert.equal(r3.tab.closed, false); assert.match(r3.failure ?? '', /could not be confirmed closed/);
    await new Promise(r => setTimeout(r, 60));
  } finally { process.off('unhandledRejection', onUnhandled); }
  assert.deepEqual(unhandled, [], 'no unhandled rejection escaped');
});

test('navigation errors, unreadable pages, load timeouts and a failed tab close are honest error receipts that still release the tab', async () => {
  const dns = fakeBridge({ navigateError: 'net::ERR_NAME_NOT_RESOLVED' });
  const r1 = await readSupplierPage({ fetchImpl: dns.fetchImpl, session: dns.session });
  assert.equal(r1.outcome, 'error'); assert.match(r1.failure ?? '', /could not be opened: net::ERR_NAME_NOT_RESOLVED/); assert.ok(!dns.calls.includes('Runtime.evaluate')); assert.equal(dns.closedTab(), 'TAB123456789');
  const broken = fakeBridge({ evaluateThrows: true });
  const r2 = await readSupplierPage({ fetchImpl: broken.fetchImpl, session: broken.session });
  assert.equal(r2.outcome, 'error'); assert.match(r2.failure ?? '', /could not be read/); assert.equal(r2.page.title, null); assert.equal(broken.closedTab(), 'TAB123456789');
  const slow = fakeBridge({ neverLoads: true });
  const r3 = await readSupplierPage({ fetchImpl: slow.fetchImpl, session: slow.session, timeoutMs: 60 });
  assert.equal(r3.outcome, 'error'); assert.match(r3.failure ?? '', /did not finish within/); assert.equal(slow.closedTab(), 'TAB123456789'); assert.ok(slow.calls.includes('close'));
  const stuck = fakeBridge({ closeFails: true });
  const r4 = await readSupplierPage({ fetchImpl: stuck.fetchImpl, session: stuck.session });
  assert.equal(r4.outcome, 'read'); assert.equal(r4.tab.closed, false, 'a close failure is reported, never hidden');
  const dead = fakeBridge(); const offline = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
  const r5 = await readSupplierPage({ fetchImpl: offline, session: dead.session });
  assert.equal(r5.outcome, 'error'); assert.match(r5.failure ?? '', /answered 503/); assert.equal(r5.tab.targetIdPrefix, null);
});

test('visible text is bounded and sanitized before it reaches a receipt', async () => {
  const fake = fakeBridge({ longText: true });
  const receipt = await readSupplierPage({ fetchImpl: fake.fetchImpl, session: fake.session });
  assert.equal(receipt.page.excerptChars, TEXT_EXCERPT_CHARS); assert.equal(receipt.page.textExcerpt?.length, TEXT_EXCERPT_CHARS);
});

class FakeSocket {
  static instances: FakeSocket[] = []; listeners = new Map<string, ((e: { data?: unknown }) => void)[]>(); sent: { id: number; method: string; params: Record<string, unknown> }[] = []; closed = false;
  constructor(public url: string) { FakeSocket.instances.push(this); queueMicrotask(() => this.emit('open', {})); }
  addEventListener(type: string, fn: (e: { data?: unknown }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  emit(type: string, e: { data?: unknown }) { for (const fn of this.listeners.get(type) ?? []) fn(e); }
  send(data: string) { const m = JSON.parse(data); this.sent.push(m); queueMicrotask(() => { if (m.method === 'Bad.call') this.emit('message', { data: JSON.stringify({ id: m.id, error: { code: -32601, message: "'Bad.call' wasn't found" } }) }); else if (m.method !== 'Never.answers') this.emit('message', { data: JSON.stringify({ id: m.id, result: { echoed: m.params } }) }); }); }
  close() { this.closed = true; }
}

test('the WebSocket session correlates replies by id, surfaces DevTools errors, dispatches events, times out and cleans up', async () => {
  const session = await webSocketSession('ws://127.0.0.1:9876/devtools/page/X', { WebSocketCtor: FakeSocket as never, requestTimeoutMs: 40 });
  const socket = FakeSocket.instances.at(-1)!;
  const events: string[] = []; session.onEvent((m, p) => events.push(`${m}:${JSON.stringify(p)}`));
  const [a, b] = await Promise.all([session.send('Page.enable'), session.send('Page.navigate', { url: 'https://www.printful.com/' })]);
  assert.deepEqual(a, { echoed: {} }); assert.deepEqual(b, { echoed: { url: 'https://www.printful.com/' } });
  assert.deepEqual(socket.sent.map(s => s.id), [1, 2], 'ids are monotonic');
  await assert.rejects(session.send('Bad.call'), /wasn't found/);
  socket.emit('message', { data: JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 2 } }) }); socket.emit('message', { data: 'not json' });
  assert.deepEqual(events, ['Page.loadEventFired:{"timestamp":2}']);
  await assert.rejects(session.send('Never.answers'), /timed out/);
  const hanging = session.send('Never.answers'); session.close();
  await assert.rejects(hanging, /was closed/); assert.equal(socket.closed, true);
  class NeverOpens { constructor(public url: string) { } addEventListener() { } send() { } close() { } }
  await assert.rejects(webSocketSession('ws://127.0.0.1:9876/devtools/page/never', { WebSocketCtor: NeverOpens as never, openTimeoutMs: 10 }), /did not open/);
});

test('the inquiry draft is unsent, bounded, and built only from company facts and the read supplier page', async () => {
  const company = { name: 'TRU Merch Studio', product: 'black T-shirts', deadline: '2026-09-18' };
  const draft = composeInquiryDraft({ company, quantity: 150, option: 'Split shipment', pageTitle: 'Custom Men’s T-Shirts | Printful', pageUrl: TARGET.url, now: () => new Date('2026-09-11T20:30:00Z') });
  assert.equal(draft.unsent, true); assert.equal(draft.channel, 'draft only'); assert.equal(draft.supplier, 'Printful');
  assert.equal(draft.subject, 'Inquiry: 150 black T-shirts needed by September 18, 2026');
  assert.match(draft.body, /TRU Merch Studio is preparing an order of 150 black T-shirts for delivery by September 18, 2026\. Our current plan is a split shipment fulfilment\./);
  assert.match(draft.body, /inquiry only\. No order is placed and no payment is authorized/); assert.match(draft.body, /Custom Men’s T-Shirts \| Printful/); assert.ok(draft.body.includes(TARGET.url));
  assert.doesNotMatch(draft.body, /@|\+1|password|token/i, 'no contact details or credentials are invented');
  assert.equal(draft.createdAt, '2026-09-11T20:30:00.000Z');
  const offsite = composeInquiryDraft({ company, quantity: 10, pageUrl: 'https://evil.example/x' });
  assert.equal(offsite.basedOn.pageUrl, null, 'an off-site URL is never quoted into a draft');
  assert.throws(() => composeInquiryDraft({ company, quantity: 0 }), /1 to 200/);
  assert.throws(() => composeInquiryDraft({ company: { ...company, deadline: 'next week' }, quantity: 5 }), /deadline/);
});

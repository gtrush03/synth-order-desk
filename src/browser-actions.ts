/**
 * Bounded real-world browser action for the talking Synth.
 *
 * Connects to the EXISTING local Chrome DevTools endpoint (127.0.0.1:9876), opens ONE dedicated tab of its
 * own, navigates to a FIXED public supplier page from the allowlist below, reads what is visible (title, URL,
 * headings, a bounded text excerpt), optionally captures a screenshot of that tab, closes only that tab and
 * returns a receipt. It never lists or touches other tabs, never reads cookies, storage or profile data,
 * never submits forms, clicks, sends, orders or purchases, never runs caller-supplied JavaScript, and never
 * closes the browser. A separate pure helper composes an UNSENT supplier inquiry draft.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { CompanyData } from './company-workspace.ts';

export const DEFAULT_CDP_BASE = 'http://127.0.0.1:9876';
export const SUPPLIER_PAGES = {
  'printful-tshirts': { id: 'printful-tshirts', supplier: 'Printful', label: "Printful · custom men's T-shirts (public catalog page)", url: 'https://www.printful.com/custom/mens/t-shirts' },
  'printful-catalog': { id: 'printful-catalog', supplier: 'Printful', label: 'Printful · custom products catalog (public page)', url: 'https://www.printful.com/custom-products' }
} as const;
export type SupplierPageId = keyof typeof SUPPLIER_PAGES;
export interface SupplierPage { id: SupplierPageId; supplier: string; label: string; url: string }
export const DEFAULT_SUPPLIER_PAGE: SupplierPageId = 'printful-tshirts';
export const TEXT_EXCERPT_CHARS = 1500;

/** Minimal DevTools session used by the action. The real one runs over a WebSocket; tests inject a fake. */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  onEvent(handler: (method: string, params: Record<string, unknown>) => void): void;
  close(): void;
}
export interface BrowserActionGuards { cookiesRead: false; storageRead: false; otherTabsInspected: false; formsSubmitted: false; clicks: 0; javascriptFromUser: false; browserClosed: false; navigationsBeyondTarget: number }
export interface BrowserActionReceipt {
  id: string; action: 'supplier-page-read'; target: SupplierPage; startedAt: string; finishedAt: string; ms: number;
  browser: { cdpHost: string; version: string | null; protocol: string | null };
  tab: { createdByThisAction: true; targetIdPrefix: string | null; closed: boolean };
  page: { finalUrl: string | null; sameSite: boolean | null; httpStatus: number | null; title: string | null; headings: string[]; textExcerpt: string | null; excerptChars: number; loadMs: number | null; mainFrameNavigations: string[] };
  screenshot: { path: string; bytes: number; sha256: string } | null;
  outcome: 'read' | 'blocked' | 'error'; failure?: string; guards: BrowserActionGuards;
}
export interface BrowserActionOptions {
  cdpBase?: string; target?: SupplierPageId; timeoutMs?: number; cleanupTimeoutMs?: number; screenshotDir?: string; receiptDir?: string;
  viewport?: { width: number; height: number };
  session?: (webSocketUrl: string) => Promise<CdpSession>;
  fetchImpl?: typeof fetch;
  progress?: (status: 'running' | 'complete' | 'error', detail: string) => void;
  now?: () => Date;
}

// ---------- real transport ----------
interface WsLike { addEventListener(type: string, listener: (event: { data?: unknown }) => void, options?: { once?: boolean }): void; send(data: string): void; close(): void }
type WsCtor = new (url: string) => WsLike;
/** A DevTools session over the page's WebSocket. Request/response correlation by id; events fan out to handlers. */
export function webSocketSession(webSocketUrl: string, options: { WebSocketCtor?: WsCtor; requestTimeoutMs?: number; openTimeoutMs?: number } = {}): Promise<CdpSession> {
  const Ctor = options.WebSocketCtor ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket;
  if (typeof Ctor !== 'function') return Promise.reject(new Error('No WebSocket implementation is available for the browser bridge.'));
  return new Promise((resolve, reject) => {
    const ws = new Ctor(webSocketUrl);
    let seq = 0, open = false;
    const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const handlers: ((method: string, params: Record<string, unknown>) => void)[] = [];
    const failAll = (message: string) => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear(); };
    const openTimer = setTimeout(() => { if (!open) { reject(new Error('The browser bridge did not open in time.')); try { ws.close(); } catch { /* ignore */ } } }, options.openTimeoutMs ?? 5000);
    const session: CdpSession = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Browser call ${method} timed out.`)); }, options.requestTimeoutMs ?? 15000);
          pending.set(id, { resolve: res, reject: rej, timer });
          try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pending.delete(id); clearTimeout(timer); rej(e as Error); }
        });
      },
      onEvent(handler) { handlers.push(handler); },
      close() { failAll('The browser bridge was closed.'); try { ws.close(); } catch { /* ignore */ } }
    };
    ws.addEventListener('open', () => { open = true; clearTimeout(openTimer); resolve(session); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(openTimer); failAll('The browser bridge connection failed.'); if (!open) reject(new Error('The browser bridge connection failed.')); });
    ws.addEventListener('close', () => { failAll('The browser bridge connection closed.'); });
    ws.addEventListener('message', event => {
      let message: { id?: unknown; result?: Record<string, unknown>; error?: { message?: string }; method?: unknown; params?: Record<string, unknown> };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.id === 'number' && pending.has(message.id)) {
        const entry = pending.get(message.id)!; pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message ?? 'The browser returned an error.')); else entry.resolve(message.result ?? {});
      } else if (typeof message.method === 'string') {
        for (const handler of handlers) { try { handler(message.method, message.params ?? {}); } catch { /* handlers never break the session */ } }
      }
    });
  });
}

// ---------- fixed, reviewed page script (no cookies, storage, forms or navigation) ----------
export const PAGE_FACTS_EXPRESSION = [
  '(() => {',
  '  const host = location.hostname.toLowerCase();',
  '  if (location.protocol !== "https:" || !["printful.com","www.printful.com"].includes(host) || !["/custom/mens/t-shirts","/custom-products"].includes(location.pathname.replace(/\\/$/,""))) return {blocked:true,url:String(location.href).slice(0,500)};',
  '  const clean = s => String(s || "").replace(/[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]/g, "").replace(/\\s+/g, " ").trim();',
  `  return { title: clean(document.title).slice(0, 200), url: String(location.href).slice(0, 500), text: clean(document.body ? document.body.innerText : "").slice(0, ${TEXT_EXCERPT_CHARS}), headings: Array.from(document.querySelectorAll("h1,h2")).slice(0, 8).map(h => clean(h.textContent).slice(0, 120)) };`,
  '})()'
].join('\n');

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/;
const cleanText = (value: unknown, max: number) => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export function sameSite(url: string, allowedUrl: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase(), allowed = new URL(allowedUrl).hostname.toLowerCase();
    const registrable = allowed.replace(/^www\./, '');
    return new URL(url).protocol === 'https:' && (host === allowed || host === registrable || host.endsWith('.' + registrable));
  } catch { return false; }
}
export function resolveSupplierPage(target: unknown): SupplierPage {
  if (typeof target !== 'string' || !Object.hasOwn(SUPPLIER_PAGES, target)) throw new Error('Choose a supplier page from the fixed allowlist.');
  return SUPPLIER_PAGES[target as SupplierPageId];
}

export const LOCATION_EXPRESSION = 'String(location.href)';
export const CLEANUP_TIMEOUT_MS = 3000;
export function allowedCatalog(url:string){try{const u=new URL(url);return u.protocol==='https:'&&['printful.com','www.printful.com'].includes(u.hostname)&&['/custom/mens/t-shirts','/custom-products'].includes(u.pathname.replace(/\/$/,''));}catch{return false;}}
/**
 * Open the fixed public supplier page in a dedicated tab of the existing local Chrome, read what is visible,
 * optionally screenshot it, close that tab, and return a receipt. One total deadline bounds every step (fetches
 * abort, DevTools calls race it) and the own-tab cleanup has its own short bound. The page address is checked
 * against the allowed site BEFORE any title, heading or text is read; an off-site page is reported as blocked
 * with nothing read. Never throws for page problems: the receipt carries `outcome` and `failure`. Throws only
 * for invalid options.
 */
export async function readSupplierPage(options: BrowserActionOptions = {}): Promise<BrowserActionReceipt> {
  const target = resolveSupplierPage(options.target ?? DEFAULT_SUPPLIER_PAGE);
  const cdpBase = options.cdpBase ?? DEFAULT_CDP_BASE;
  if (!LOOPBACK.test(cdpBase)) throw new Error('The browser bridge must be the existing local loopback DevTools endpoint.');
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? (() => new Date()), timeoutMs = Math.max(1, options.timeoutMs ?? 20000), cleanupTimeoutMs = Math.max(1, options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS);
  const started = Date.now(), startedAt = now().toISOString(), id = randomUUID();
  const receipt: BrowserActionReceipt = {
    id, action: 'supplier-page-read', target, startedAt, finishedAt: startedAt, ms: 0,
    browser: { cdpHost: new URL(cdpBase).host, version: null, protocol: null }, tab: { createdByThisAction: true, targetIdPrefix: null, closed: false },
    page: { finalUrl: null, sameSite: null, httpStatus: null, title: null, headings: [], textExcerpt: null, excerptChars: 0, loadMs: null, mainFrameNavigations: [] },
    screenshot: null, outcome: 'error',
    guards: { cookiesRead: false, storageRead: false, otherTabsInspected: false, formsSubmitted: false, clicks: 0, javascriptFromUser: false, browserClosed: false, navigationsBeyondTarget: 0 }
  };
  const progress = (status: 'running' | 'complete' | 'error', detail: string) => { try { options.progress?.(status, detail); } catch { /* progress is best-effort */ } };
  // One total deadline for every step: fetches abort through the controller and DevTools calls race the same promise.
  const controller = new AbortController();
  let expire: (error: Error) => void = () => { };
  const deadline = new Promise<never>((_, reject) => { expire = reject; });
  deadline.catch(() => { /* observed only through races; never an unhandled rejection */ });
  const timer = setTimeout(() => { const error = new Error(`The browser action did not finish within ${Math.max(1, Math.round(timeoutMs / 1000))} s.`); controller.abort(error); expire(error); }, timeoutMs);
  const bounded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);
  let tabId: string | null = null, session: CdpSession | null = null;
  try {
    progress('running', `Opening ${target.label} in a dedicated browser tab`);
    const version = await bounded(fetchImpl(`${cdpBase}/json/version`, { signal: controller.signal }).then(r => r.ok ? r.json() as Promise<Record<string, unknown>> : Promise.reject(new Error(`The browser bridge answered ${r.status}.`))));
    receipt.browser.version = typeof version.Browser === 'string' ? version.Browser.slice(0, 60) : null;
    receipt.browser.protocol = typeof version['Protocol-Version'] === 'string' ? String(version['Protocol-Version']) : null;
    const created = await bounded(fetchImpl(`${cdpBase}/json/new?about:blank`, { method: 'PUT', signal: controller.signal }).then(r => r.ok ? r.json() as Promise<{ id?: string; webSocketDebuggerUrl?: string }> : Promise.reject(new Error(`The browser refused a new tab (${r.status}).`))));
    if (!created.id || !created.webSocketDebuggerUrl) throw new Error('The browser did not return a tab of our own.');
    tabId = created.id; receipt.tab.targetIdPrefix = created.id.slice(0, 8);
    session = await bounded((options.session ?? webSocketSession)(created.webSocketDebuggerUrl));
    let loadResolve: () => void = () => { };
    const loaded = new Promise<void>(resolve => { loadResolve = resolve; });
    session.onEvent((method, params) => {
      if(method==='Fetch.requestPaused'){
        const request=params as {requestId:string;request?:{url?:string}};
        const allow=typeof request.request?.url==='string'&&allowedCatalog(request.request.url);
        void session!.send(allow?'Fetch.continueRequest':'Fetch.failRequest',allow?{requestId:request.requestId}:{requestId:request.requestId,errorReason:'BlockedByClient'}).catch(()=>{controller.abort(new Error('The supplier navigation guard failed.'));});
      }
      if (method === 'Page.loadEventFired') loadResolve();
      if (method === 'Network.responseReceived') { const p = params as { type?: string; response?: { status?: number } }; if (p.type === 'Document' && receipt.page.httpStatus === null && typeof p.response?.status === 'number') receipt.page.httpStatus = p.response.status; }
      if (method === 'Page.frameNavigated') { const frame = (params as { frame?: { parentId?: string; url?: string } }).frame; if (frame && !frame.parentId && typeof frame.url === 'string' && frame.url !== 'about:blank') { if (receipt.page.mainFrameNavigations.length < 10) receipt.page.mainFrameNavigations.push(frame.url.slice(0, 300)); if (!sameSite(frame.url, target.url)) receipt.guards.navigationsBeyondTarget++; } }
    });
    await bounded(session.send('Page.enable')); await bounded(session.send('Runtime.enable')); await bounded(session.send('Network.enable'));
    await bounded(session.send('Fetch.enable',{patterns:[{resourceType:'Document',requestStage:'Request'}]}));
    if (options.viewport) await bounded(session.send('Emulation.setDeviceMetricsOverride', { width: options.viewport.width, height: options.viewport.height, deviceScaleFactor: 1, mobile: false }));
    const navigateStarted = Date.now();
    const navigation = await bounded(session.send('Page.navigate', { url: target.url })) as { errorText?: string };
    if (navigation.errorText) throw new Error(`The supplier page could not be opened: ${cleanText(navigation.errorText, 120)}.`);
    await bounded(loaded);
    receipt.page.loadMs = Date.now() - navigateStarted;
    // Origin gate BEFORE any content is read: only the address is inspected.
    const where = await bounded(session.send('Runtime.evaluate', { expression: LOCATION_EXPRESSION, returnByValue: true })) as { result?: { value?: unknown } };
    receipt.page.finalUrl = cleanText(where.result?.value, 500) || null;
    receipt.page.sameSite = receipt.page.finalUrl ? allowedCatalog(receipt.page.finalUrl) : false;
    if (!receipt.page.sameSite) { receipt.outcome = 'blocked'; receipt.failure = 'The supplier page left the allowed site; nothing on the other site was read.'; progress('error', receipt.failure); return receipt; }
    const evaluated = await bounded(session.send('Runtime.evaluate', { expression: PAGE_FACTS_EXPRESSION, returnByValue: true })) as { result?: { value?: { title?: unknown; url?: unknown; text?: unknown; headings?: unknown } }; exceptionDetails?: unknown };
    if (evaluated.exceptionDetails || !evaluated.result?.value) throw new Error('The supplier page could not be read.');
    const facts = evaluated.result.value;
    const factsUrl = cleanText(facts.url, 500);
    if (factsUrl && !allowedCatalog(factsUrl)) { receipt.page.finalUrl = factsUrl; receipt.page.sameSite = false; receipt.outcome = 'blocked'; receipt.failure = 'The supplier page moved off the allowed site while being read; its content was discarded.'; progress('error', receipt.failure); return receipt; }
    receipt.page.title = cleanText(facts.title, 200) || null;
    receipt.page.headings = Array.isArray(facts.headings) ? facts.headings.map(h => cleanText(h, 120)).filter(Boolean).slice(0, 8) : [];
    receipt.page.textExcerpt = cleanText(facts.text, TEXT_EXCERPT_CHARS) || null; receipt.page.excerptChars = receipt.page.textExcerpt?.length ?? 0;
    if (options.screenshotDir) {
      const navCount=receipt.page.mainFrameNavigations.length;
      if(receipt.guards.navigationsBeyondTarget>0||!allowedCatalog(receipt.page.mainFrameNavigations.at(-1)??factsUrl))throw new Error('The supplier page changed before its preview could be captured.');
      const shot = await bounded(session.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
      const after=await bounded(session.send('Runtime.evaluate',{expression:LOCATION_EXPRESSION,returnByValue:true})) as {result?:{value?:unknown}};
      if(receipt.guards.navigationsBeyondTarget>0||receipt.page.mainFrameNavigations.length!==navCount||!allowedCatalog(String(after.result?.value??'')))throw new Error('The supplier page changed during capture; no preview was saved.');
      if (typeof shot.data === 'string' && shot.data.length) {
        const bytes = Buffer.from(shot.data, 'base64'); await mkdir(options.screenshotDir, { recursive: true });
        const path = `${options.screenshotDir}/${id}.png`; await writeFile(path, bytes, { mode: 0o600 });
        receipt.screenshot = { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
    }
    receipt.outcome = 'read';
    progress('complete', `Read “${receipt.page.title ?? target.supplier}” (${receipt.page.excerptChars} characters of visible text); nothing submitted or sent`);
  } catch (error) {
    receipt.outcome = receipt.outcome === 'read' ? 'read' : 'error';
    receipt.failure = cleanText((error as Error).message, 300) || 'The browser action failed.';
    progress('error', receipt.failure);
  } finally {
    clearTimeout(timer);
    if (session) { try { session.close(); } catch { /* ignore */ } }
    if (tabId) {
      // Closing our own tab is bounded on its own so a stalled bridge cannot hang the action or leave it unreported.
      const cleanup = new AbortController(); const cleanupTimer = setTimeout(() => cleanup.abort(new Error('cleanup timed out')), cleanupTimeoutMs);
      const closeCall = fetchImpl(`${cdpBase}/json/close/${tabId}`, { signal: cleanup.signal });
      const closeDeadline = new Promise<never>((_, reject) => cleanup.signal.addEventListener('abort', () => reject(new Error('cleanup timed out')), { once: true }));
      closeDeadline.catch(() => { /* observed through the race */ });
      try { const closed = await Promise.race([closeCall, closeDeadline]); receipt.tab.closed = closed.ok; }
      catch { receipt.tab.closed = false; }
      finally { clearTimeout(cleanupTimer); closeCall.catch(() => { /* aborted or failed close is reported via tab.closed */ }); }
      if (!receipt.tab.closed) receipt.failure = `${receipt.failure ? receipt.failure + ' ' : ''}The dedicated tab could not be confirmed closed.`;
    }
    receipt.finishedAt = now().toISOString(); receipt.ms = Date.now() - started;
    if (options.receiptDir) { await mkdir(options.receiptDir, { recursive: true }); await writeFile(`${options.receiptDir}/${id}.json`, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 }); }
  }
  return receipt;
}

// ---------- unsent inquiry draft (pure; nothing is typed into any site or sent anywhere) ----------
export interface InquiryDraft { unsent: true; channel: 'draft only'; supplier: string; subject: string; body: string; quantity: number; product: string; deadline: string; option: string | null; basedOn: { pageTitle: string | null; pageUrl: string | null }; createdAt: string }
export function composeInquiryDraft(input: { company: Pick<CompanyData, 'name' | 'product' | 'deadline'>; quantity: number; option?: string | null; supplier?: string; pageTitle?: string | null; pageUrl?: string | null; now?: () => Date }): InquiryDraft {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 200) throw new Error('Use a whole quantity from 1 to 200 for this sample.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.company.deadline)) throw new Error('Invalid company deadline.');
  const supplier = cleanText(input.supplier ?? SUPPLIER_PAGES[DEFAULT_SUPPLIER_PAGE].supplier, 60) || 'Supplier';
  const company = cleanText(input.company.name, 80) || 'Our company', product = cleanText(input.company.product, 80) || 'products';
  const deadline = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${input.company.deadline}T12:00:00Z`));
  const option = input.option ? cleanText(input.option, 60) : null;
  const pageTitle = input.pageTitle ? cleanText(input.pageTitle, 200) : null, pageUrl = input.pageUrl && sameSite(input.pageUrl, SUPPLIER_PAGES[DEFAULT_SUPPLIER_PAGE].url) ? cleanText(input.pageUrl, 300) : null;
  const subject = `Inquiry: ${input.quantity} ${product} needed by ${deadline}`;
  const body = [
    `Hello ${supplier} team,`, '',
    `${company} is preparing an order of ${input.quantity} ${product} for delivery by ${deadline}.${option ? ` Our current plan is a ${option.toLowerCase()} fulfilment.` : ''}`,
    `Could you confirm current availability, unit pricing at this quantity, and the production plus shipping lead time to meet that date?${pageTitle ? ` We are looking at “${pageTitle}”${pageUrl ? ` (${pageUrl})` : ''}.` : ''}`, '',
    'This is an inquiry only. No order is placed and no payment is authorized by this message.', '',
    `Thank you,`, company
  ].join('\n');
  return { unsent: true, channel: 'draft only', supplier, subject, body, quantity: input.quantity, product, deadline: input.company.deadline, option, basedOn: { pageTitle, pageUrl }, createdAt: (input.now ?? (() => new Date()))().toISOString() };
}

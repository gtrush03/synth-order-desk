import { previewScenario } from './data/preview.js';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const date = value => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
let scenarios = [], current;

function setBrief(quantity, budget, oneShipment) {
  $('quantity').value = quantity; $('budget').value = budget; $('one-shipment').checked = oneShipment; calculate();
}
function stockLine(label, value) { const row = el('div', undefined, 'stock-line'); row.append(el('span', label), el('strong', value)); return row; }
function table(headers, rows) {
  const wrap = el('div', undefined, 'table-scroll'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', headers.join(', '));
  const t = el('table'), head = el('thead'), tr = el('tr'), body = el('tbody');
  headers.forEach(h => { const th = el('th', h); th.scope = 'col'; tr.append(th); }); head.append(tr);
  rows.forEach(row => { const tr = el('tr'); row.forEach(v => tr.append(el('td', String(v)))); body.append(tr); });
  t.append(head, body); wrap.append(t); return wrap;
}
function showScenario(scenario) {
  current = scenario; const c = current.company;
  document.querySelectorAll('[data-scenario]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scenario === current.id)));
  $('scenario-title').textContent = c.product; $('scenario-summary').textContent = current.summary;
  $('unit').textContent = `(${current.unit})`; $('deadline').textContent = date(c.deadline);
  $('stock-summary').replaceChildren(stockLine('Available now', `${c.stock.available} ${current.unit}`), stockLine('From stock / unit', money(c.stock.unitCents)), stockLine('Rush production / unit', money(c.stock.rushUnitCents)));
  if (c.stockLots?.length) $('stock-summary').append(stockLine('Reserved units', c.stockLots.reduce((sum, l) => sum + l.reserved, 0)), stockLine('Quality hold · excluded', c.stockLots.filter(l => l.status === 'quality-hold').reduce((sum, l) => sum + l.available, 0)));
  $('stock-lots').replaceChildren();
  if (c.stockLots?.length) {
    const detail = el('details', undefined, 'lot-toggle'); detail.append(el('summary', `Inspect ${c.stockLots.length} inventory rows · reservations & holds`));
    detail.append(table(['Location / size', 'Units', 'Reserved', 'Status'], c.stockLots.map(l => [`${l.location} / ${l.variant}`, l.available, l.reserved, l.status === 'quality-hold' ? 'Quality hold' : 'Ready'])));
    detail.append(el('p', 'Available now is the quoted stock aggregate. Inventory rows show reservations and holds; held lots are not added to quoted availability.', 'field-hint')); $('stock-lots').append(detail);
  }
  $('shipping-data').replaceChildren(table(['Option', 'Unit price', 'Shipping', 'Arrival'], c.shipping.map(s => [s.name, s.id === 'split' ? 'Stock + rush' : money(s.unitCents), money(s.shippingCents), date(s.arrival)])));
  $('source-note').textContent = `Sample source: ${c.name}. Deadline ${date(c.deadline)}. Shipping is charged once per option; split uses stock and rush unit rates. These are illustrative planning data, not live supplier inventory.`;
  const questions = [
    [`Can we get ${current.quantity} ${current.unit} for ${money(current.budgetDollars * 100)}?`, current.quantity, current.budgetDollars, false],
    [`What if we need 10 fewer ${current.unit}?`, Math.max(1, current.quantity - 10), current.budgetDollars, false],
    ['What changes if everything must arrive together?', current.quantity, current.budgetDollars, true]
  ];
  $('starter-questions').replaceChildren(...questions.map(([label, q, b, rule]) => { const button = el('button', `${label} ↗`); button.type = 'button'; button.onclick = () => setBrief(q, b, rule); return button; }));
  setBrief(current.quantity, current.budgetDollars, false);
}
function calculate() {
  const q = $('quantity'), b = $('budget'), rule = $('one-shipment').checked;
  const quantity = q.valueAsNumber, budget = b.valueAsNumber;
  const error = !q.validity.valid || !b.validity.valid || !Number.isInteger(quantity) || !Number.isFinite(budget) ? 'Enter a whole quantity from 1 to 200 and a budget from $0 to $10,000 (up to two decimal places).' : '';
  $('input-error').hidden = !error; $('input-error').textContent = error;
  q.setAttribute('aria-invalid', String(!q.validity.valid)); b.setAttribute('aria-invalid', String(!b.validity.valid));
  if (error) { $('recommendation').replaceChildren(el('p', 'Update your brief to calculate the options.')); $('options').replaceChildren(); $('option-context').textContent = ''; return; }
  let quote;
  try { quote = previewScenario(current.company, quantity, budget, rule); }
  catch (error) { $('input-error').hidden = false; $('input-error').textContent = error.message; $('recommendation').replaceChildren(); $('options').replaceChildren(); return; }
  $('option-context').textContent = `${quantity} ${current.unit} · by ${date(current.company.deadline)}`;
  const title = quote.chosen ? `${quote.chosen.name} fits — ${money(quote.chosen.totalCents)}` : 'No option meets the whole brief.';
  const explanation = quote.chosen ? `${money(quote.budgetCents - quote.chosen.totalCents)} inside your budget. Arrives ${date(quote.chosen.arrival)}${rule ? ', in one shipment' : ''}. This is the lowest-cost option that meets your rules.` : 'Compare the reasons below. Try a smaller quantity, a larger budget, or allowing split delivery.';
  $('recommendation').replaceChildren(el('strong', title), el('p', explanation));
  $('options').replaceChildren(...quote.options.map(option => {
    const row = el('article', undefined, 'option'); row.dataset.option = option.id;
    row.append(el('h5', option.name), el('span', money(option.totalCents), 'price'));
    const breakdown = option.id === 'split' ? `${Math.min(quantity,current.company.stock.available)} stock + ${Math.max(0,quantity-current.company.stock.available)} rush units + ${money(current.company.shipping.find(s => s.id === option.id).shippingCents)} shipping` : `${quantity} × ${money(current.company.shipping.find(s => s.id === option.id).unitCents)} + ${money(current.company.shipping.find(s => s.id === option.id).shippingCents)} shipping`;
    row.append(el('p', breakdown)); const flags = el('div', undefined, 'flags');
    flags.append(el('span', `${option.onTime ? '✓' : '×'} Arrives ${date(option.arrival)}${option.onTime ? ' · on time' : ' · too late'}`, option.onTime ? 'pass' : 'fail'));
    flags.append(el('span', option.withinBudget ? '✓ Within budget' : `× ${money(option.totalCents-quote.budgetCents)} over budget`, option.withinBudget ? 'pass' : 'fail'));
    if (rule) flags.append(el('span', option.id === 'split' ? '× Splits the shipment' : '✓ One shipment', option.id === 'split' ? 'fail' : 'pass'));
    row.append(flags); return row;
  }));
}
function safeMedia(value) {
  if (typeof value !== 'string' || !value || /[\\\x00-\x1f]/.test(value)) return null;
  try { const url = new URL(value, location.href); return url.protocol === 'https:' || (url.origin === location.origin && !value.startsWith('//')) ? url.href : null; } catch { return null; }
}
async function availableAsset(value) {
  const url = safeMedia(value); if (!url) return null;
  // Publication config may be staged before its files. Keep missing local assets pending.
  if (new URL(url).origin === location.origin) {
    try { const response = await fetch(url, {method:'HEAD', signal:AbortSignal.timeout(4000)}); return response.ok && !/text\/html/i.test(response.headers.get('content-type') ?? '') ? url : null; } catch { return null; }
  }
  return url;
}
async function loadConfig() {
  try {
    const response = await fetch('./showcase-config.json', { cache: 'no-store' }); if (!response.ok) return;
    const config = await response.json();
    const [videoUrl, posterUrl, captionUrl, transcriptUrl, presentationUrl] = await Promise.all([config.demoVideoUrl, config.posterUrl, config.captionUrl, config.transcriptUrl, config.presentationUrl].map(availableAsset));
    if (config.repoUrl === 'https://github.com/gtrush03/synth-order-desk') document.querySelectorAll('.repo-link').forEach(a => { a.href = config.repoUrl; });
    if (videoUrl) document.querySelector('.recording-caption').textContent = `${config.demoVideoKind === 'edited-video' ? 'Edited demonstration' : 'Recorded workflow'} · Apple reasoning on the demo Mac. Narration details are in the transcript.`;
    if (typeof config.eventWorkspaceUrl === 'string' && /^https:\/\//.test(config.eventWorkspaceUrl)) {
      const eventUrl = safeMedia(config.eventWorkspaceUrl), eventExpiry = new Date(config.eventWorkspaceExpiresAt ?? config.tenkiPreviewExpiresAt);
      if (eventUrl && Number.isFinite(eventExpiry.getTime())) {
        const link = el('a', 'Explore the event workspace ↗', 'button'), note = el('p', undefined, 'category');
        const label = eventExpiry.toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles',timeZoneName:'short'});
        const update = () => { const expired = Date.now() >= eventExpiry.getTime(); link.hidden = expired; if (expired) link.removeAttribute('href'); else link.href = eventUrl; note.textContent = expired ? `The temporary event demo expired ${label}.` : `Temporary event demo · public link expires ${label}. This is not official event registration.`; };
        update(); document.querySelector('.closing').append(link, note); const timer = setInterval(() => { update(); if (Date.now() >= eventExpiry.getTime()) clearInterval(timer); },30000);
      }
    }
    if (videoUrl) {
      const video = $('demo-video'); video.src = videoUrl; if (posterUrl) video.poster = posterUrl; video.hidden = false; $('video-pending').hidden = true;
      video.addEventListener('error', () => { video.hidden = true; $('video-pending').hidden = false; $('video-pending').querySelector('p').textContent = 'The recording could not load. Its final file is pending.'; });
    }
    if (videoUrl) { $('download-video').href = videoUrl; $('download-video').setAttribute('download', ''); $('download-video').hidden = false; }
    if (captionUrl) {
      const track = document.createElement('track'); track.kind = 'captions'; track.label = 'English'; track.srclang = 'en'; track.src = captionUrl; track.default = true; $('demo-video').append(track);
      $('captions-link').href = captionUrl; $('captions-link').hidden = false;
    }
    if (transcriptUrl) { $('transcript-link').href = transcriptUrl; $('transcript-link').hidden = false; }
    if (presentationUrl) document.querySelectorAll('.presentation-link').forEach(link => { link.href = presentationUrl; link.hidden = false; });
    if (typeof config.tenkiPreviewUrl === 'string' && /^https:\/\/[a-z0-9-]+\.us\.sb\.tenki\.sh\/?$/.test(config.tenkiPreviewUrl)) {
      const liveUrl = safeMedia(config.tenkiPreviewUrl), expiry = new Date(config.tenkiPreviewExpiresAt);
      if (liveUrl && Number.isFinite(expiry.getTime())) {
        $('cloud-preview').hidden = false;
        const expiryLabel = expiry.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' });
        const updateExpiry = () => {
          const expired = Date.now() >= expiry.getTime();
          $('tenki-expiry').textContent = expired ? `This temporary workspace expired ${expiryLabel}. Use the recording, transcript and source above.` : `Temporary preview · available until ${expiryLabel}.`;
          $('tenki-link').hidden = expired;
          if (!expired) $('tenki-link').href = liveUrl; else $('tenki-link').removeAttribute('href');
        };
        updateExpiry(); const timer = setInterval(() => { updateExpiry(); if (Date.now() >= expiry.getTime()) clearInterval(timer); }, 30000);
      }
    }
    if (typeof config.tenkiDesktopUrl === 'string' && /^https:\/\/[a-z0-9-]+\.us\.sb\.tenki\.sh(?:\/|$)/.test(config.tenkiDesktopUrl)) {
      const desktopUrl = safeMedia(config.tenkiDesktopUrl), desktopExpiry = new Date(config.tenkiDesktopExpiresAt);
      if (desktopUrl && Number.isFinite(desktopExpiry.getTime())) {
        $('cloud-preview').hidden = false; $('tenki-desktop-expiry').hidden = false;
        const label = desktopExpiry.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Los_Angeles',timeZoneName:'short'});
        const update = () => {const expired=Date.now()>=desktopExpiry.getTime();$('tenki-desktop-link').hidden=expired;if(expired)$('tenki-desktop-link').removeAttribute('href');else $('tenki-desktop-link').href=desktopUrl;$('tenki-desktop-expiry').textContent=expired?`The live view expired ${label}. Saved work and recording are separate.`:`Read-only live computer · ends ${label}.`;};
        update(); const timer=setInterval(()=>{update();if(Date.now()>=desktopExpiry.getTime())clearInterval(timer);},30000);
      }
    }
    if (typeof config.workTicketUrl === 'string' && /^https:\/\/github\.com\/gtrush03\/synth-order-desk\/issues\/[1-9]\d*$/.test(config.workTicketUrl)) {
      $('work-ticket').href = config.workTicketUrl; $('work-ticket').hidden = false; $('ticket-pending').hidden = true;
    }
  } catch { /* Optional publication assets remain explicitly pending. */ }
}
$('brief').addEventListener('submit', e => { e.preventDefault(); calculate(); });
$('brief').addEventListener('input', () => { if (current) calculate(); });
$('reset').addEventListener('click', () => showScenario(current));
try {
  const response = await fetch('./data/scenarios.json'); if (!response.ok) throw new Error('Sample dataset unavailable.');
  const data = await response.json(); if (!Array.isArray(data.scenarios) || !data.scenarios.length) throw new Error('No sample projects available.');
  scenarios = data.scenarios;
  $('scenario-tabs').replaceChildren(...scenarios.map(s => { const button = el('button', s.title); button.type = 'button'; button.dataset.scenario = s.id; button.setAttribute('aria-pressed', 'false'); button.onclick = () => showScenario(s); return button; }));
  showScenario(scenarios[0]); $('workspace').hidden = false; $('loading').hidden = true;
} catch (error) { $('loading').textContent = `${error.message} Reload the page to try again, or open the project source.`; }
await loadConfig();

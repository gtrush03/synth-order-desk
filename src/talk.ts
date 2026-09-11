import { isCurrentPacket, historicalShipmentPolicyIndexes, type ConversationState, type ConversationEvent } from './conversation-model.ts';
import {GptLiveBrowser,liveHttpCallbacks} from './gpt-live-browser.ts';
import { SPONSORS, LOCAL_STACK, EVIDENCE_NOTE, type SponsorEvidence } from './sponsor-evidence.ts';

const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
const count=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('en-US'):'—';
const day=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)):value;
const clock=(at:string)=>{const d=new Date(at);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(d);};
const num=(text:string,pattern:RegExp)=>{const m=text.match(pattern);return m?Number(m[1]):null;};
const duration=(ms:number|null)=>ms==null?'':ms>=1000?`${(ms/1000).toFixed(1)} s`:`${count(ms)} ms`;
/** Only local saved files and the exact public work-ticket repository are linked. */
const safeUrl=(u:string)=>u.trim()===u&&(/^\/api\/conversation\/(artifact|receipt)\/[a-f0-9-]{36}$/.test(u)||/^https:\/\/github\.com\/gtrush03\/synth-order-desk\/issues\/[1-9]\d*$/.test(u)||/^https:\/\/(?:[a-z2-7]{32}|synth-order-work--23h39h)\.us\.sb\.tenki\.sh\/?$/.test(u))?u:'';

type VoiceState='off'|'listening'|'transcribing'|'thinking'|'speaking'|'paused'|'nospeech'|'error';
interface Activity { key:string; name:string; short:string; detail:string; at:string; sponsor:string|null; warn?:boolean }
interface Company { name:string; product:string; deadline:string; sampleData:boolean }
interface WorkspaceMap {title:string;description:string;sampleData:boolean;sourceSha:string;product:string;deadline:string;inventory:{label:string;available:number;reserved?:number;unitCents:number;kind:string}[];shipping:{id:string;name:string;arrival:string;shippingCents:number;unitCents:number}[];instructions:{text:string;active:boolean}[];starterRequests:{label:string;message:string}[];context:{label:string;value:string;detail:string}[]}
let workspace:WorkspaceMap|null=null,workspaceRequest=0;

let state:ConversationState|null=null,busy=true,handsFree=false,listening=false,speaking=false,muted=false;
let recorder:MediaRecorder|null=null,stream:MediaStream|null=null,context:AudioContext|null=null,frame=0;
let cancelRecording=false,turnStartedAt=0,voiceState:VoiceState='off',company:Company|null=null;
const voiceRuns={count:0,engine:'' ,at:''};
const dialog=$<HTMLDialogElement>('#proof');
let liveVoice:GptLiveBrowser|null=null,liveConnected=false,liveEnabled=false;
const liveAudio=$<HTMLAudioElement>('#live-audio');
async function startLiveVoice(){
 if(!state)await startConversation();
 liveConnected=true;clearError();updateControls();
 liveVoice=new GptLiveBrowser({audio:liveAudio,...liveHttpCallbacks(),onStatus:(status,detail)=>{liveAudio.hidden=!liveConnected;setVoice(status==='working'?'thinking':status==='listening'?'listening':status==='error'?'error':'off',detail);if(status==='working'){busy=true;turnStartedAt=Date.now();startProgress();}if(['closed','error','unconfirmed'].includes(status)){liveConnected=false;busy=false;liveAudio.hidden=true;void stopProgress(false);}updateControls();},onTranscript:fragment=>{if(fragment.role==='user')$('#voice-status').textContent=`You: ${fragment.delta}`;},onResult:()=>{void (async()=>{if(state)state=await api(`/api/conversation?id=${encodeURIComponent(state.id)}`);busy=false;await stopProgress();render();scrollToLatest();})();}});
 await liveVoice.start(state!.id);
}
void api('/api/gpt-live/status').then(info=>{liveEnabled=info.enabled===true;$<HTMLSelectElement>('#voice-mode').hidden=!liveEnabled;}).catch(()=>{});

/* ---------- small state helpers ---------- */
function error(message:string,reload=false){$('#error-text').textContent=message;$('#error-reload').hidden=!reload;$('#error').hidden=false;queueMicrotask(()=>{(reload?$('#error-reload'):$('#error')).focus({preventScroll:true});revealAboveComposer($('#error'));});}
function clearError(){$('#error').hidden=true;}
function setVoice(next:VoiceState,message:string){voiceState=next;$('#voice-status').textContent=message;$('.voice-line').dataset.voice=next;}
function updateControls(){
  $<HTMLButtonElement>('#send').disabled=busy;$<HTMLButtonElement>('#attach').disabled=busy;$<HTMLButtonElement>('#new-chat').disabled=busy;
  document.querySelectorAll<HTMLButtonElement>('[data-work-action], #send-demo-email, #save-printful').forEach(b=>{b.disabled=busy;});
  $('#talk').setAttribute('aria-pressed',String(handsFree||liveConnected));$('#talk-label').textContent=handsFree||liveConnected||listening||speaking?'Stop voice':'Start talking';
  $('.voice-line').classList.toggle('listening',listening);$('.voice-line').dataset.voice=voiceState;
  $('#working').hidden=!busy||!$('#live').hidden;document.body.classList.toggle('busy',busy);document.body.classList.toggle('has-conversation',busy||!!state?.messages.length);
}
async function api(path:string,options:RequestInit={}){
  const response=await fetch(path,{...options,signal:AbortSignal.timeout(120000)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'The local service could not finish this request.');return value;
}
function remember(id:string){try{sessionStorage.setItem('tru-conversation-id',id);}catch{}}
function forget(){try{sessionStorage.removeItem('tru-conversation-id');}catch{}}
async function startConversation(){clearTimeout(progressTimer);progressAbort?.abort();progressRun++;state=await api('/api/conversation/new',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});remember(state!.id);turnStartedAt=0;voiceRuns.count=0;progress=null;render();}

/* ---------- turning server events into visible activity ---------- */
function describe(e:ConversationEvent):Activity{
  const d=e.detail,ms=num(d,/(\d+) ms/),base={detail:d,at:e.at};
  if(e.id==='rocketride-review'){const task=d.match(/task ([a-z0-9]+)/i)?.[1],units=d.match(/delta ([\d.]+) grant units/)?.[1],terminated=/terminated true/.test(d);return {...base,key:'rocketride',name:'RocketRide',short:`cloud verdict${task?` · task ${task}`:''} · ${duration(ms)}${terminated?' · terminated':''}${units?` · ${units} units`:''}`,sponsor:'rocketride',warn:!terminated};}
  if(e.id.startsWith('rocketride'))return {...base,key:'rocketride',name:'RocketRide',short:e.label.replace(/^RocketRide[\s:·-]*/i,'').slice(0,70)||'ran',sponsor:'rocketride',warn:/fail|error|pause|unavailable/i.test(e.label+' '+d)};
  switch(e.id){
    case 'company-data':
      if(e.label.includes('Hotdata snapshot'))return {...base,key:'hotdata',name:'Hotdata',short:'verified snapshot reused, under five minutes old',sponsor:'hotdata'};
      if(e.label.includes('Hotdata'))return {...base,key:'hotdata',name:'Hotdata',short:`${num(d,/(\d+) Hotdata databases/)??3} scoped databases · ${count(num(d,/(\d+) ms SQL overlap/)??0)} ms SQL overlap`,sponsor:'hotdata'};
      return {...base,key:'desk',name:'Company files',short:'local company data read',sponsor:null};
    case 'hydra-constraints':return {...base,key:'hydradb',name:'HydraDB',short:`${num(d,/(\d+) returned constraints/)??'?'} constraints · ${duration(ms)}`,sponsor:'hydradb'};
    case 'rote-review':return {...base,key:'rote',name:'Rote',short:`order-review Play · ${duration(ms)}`,sponsor:'rote'};
    case 'rote-packet':return {...base,key:'rote',name:'Rote',short:`work-packet Play · ${duration(ms)}`,sponsor:'rote'};
    case 'cognee-recall':return {...base,key:'cognee',name:'Cognee',short:`recalled revision ${num(d,/revision (\d+)/)??'?'}`,sponsor:'cognee'};
    case 'cognee-save':return {...base,key:'cognee',name:'Cognee',short:`saved revision ${num(d,/revision (\d+)/)??'?'}`,sponsor:'cognee'};
    case 'cognee-save-pending':return {...base,key:'cognee',name:'Cognee',short:'write unconfirmed · kept locally',sponsor:'cognee',warn:true};
    case 'local-language-model':return {...base,key:'apple',name:'On-device model',short:`${d.match(/interpreted [“"]([a-z]+)[”"]/)?.[1]??'understood'} · ${duration(ms)}`,sponsor:null};
    case 'company-memory':return {...base,key:'desk',name:'Workspace',short:`${num(d,/(\d+) saved instructions/)??0} instructions · ${num(d,/(\d+) previous approved/)??0} past approvals`,sponsor:null};
    case 'local-options':return {...base,key:'desk',name:'Options',short:'three fulfillment options checked',sponsor:null};
    case 'local-approval':return {...base,key:'desk',name:'Approval',short:'exact proposal approved',sponsor:null};
    case 'local-memory':return {...base,key:'desk',name:'Instruction',short:'saved for this company',sponsor:null};
    case 'local-draft':return {...base,key:'desk',name:'Draft',short:'written · unsent',sponsor:null};
    case 'review-paused':return {...base,key:'desk',name:'Review paused',short:'prior approval cleared · review again',sponsor:null,warn:true};
    case 'launch-kit':return {...base,key:'desk',name:'Launch kit',short:'supplier email + social post drafted · unsent',sponsor:null};
    case 'printful-draft-saved':return {...base,key:'printful',name:'Printful',short:'sample draft saved · unsubmitted',sponsor:null};
    case 'project-email-sent':return {...base,key:'gmail',name:'Gmail',short:'demo sent to owner · provider confirmed',sponsor:null};
    case 'gmail-draft':return {...base,key:'gmail',name:'Gmail',short:'draft saved · no recipient · not sent',sponsor:null};
    case 'gmail-draft-pending':return {...base,key:'gmail',name:'Gmail',short:'draft not confirmed · local preview saved',sponsor:null,warn:true};
    case 'browser-read':return {...base,key:'browser',name:'Supplier page',short:'read-only browser result',sponsor:null};
    case 'github-ticket':return {...base,key:'desk',name:'GitHub ticket',short:/existing ticket reused/i.test(d)?'existing public ticket reused':'published to the public project',sponsor:null};
    default:return {...base,key:'desk',name:e.label,short:'',sponsor:null};
  }
}
const ranNow=(at:string)=>turnStartedAt>0&&Date.parse(at)>=turnStartedAt-1500;
const chip=(a:Activity)=>`<button type="button" class="chip ${a.key}${a.warn?' warn':''}" data-open="${a.sponsor??''}" title="${esc(a.detail)}"><b>${esc(a.name)}</b>${a.short?`<span>${esc(a.short)}</span>`:''}</button>`;

/* ---------- rendering ---------- */
function render(){
  const messages=state?.messages??[],events=state?.events??[];
  $('#welcome').hidden=messages.length>0;
  renderBrief();syncWorkspace();renderOpening(events,messages.length>0);renderThread(messages,events);renderArtifacts();renderOrder();renderActivity(events);
  updateControls();
}
function renderBrief(){$('#brief-company').textContent=company?`${company.name} · ${company.sampleData?'sample data':'company data'} · deadline ${day(company.deadline)}`:'Company workspace';}
/* The workspace is a read-only view of the same company source used for quoting. */
function renderWorkspace(){
  if(!workspace)return;
  const w=workspace;
  $('#workspace-title').textContent='See the sample data';
  $('#workspace-description').textContent='Plan event merch, compare delivery options, and prepare the approved handoff.';
  $('#workspace-kind').textContent=w.sampleData?'Sample company data':'Company data';
  $('#workspace-product').textContent=`${w.product} · due ${day(w.deadline)}`;
  $('#workspace-starters').innerHTML=w.starterRequests.slice(0,3).map(r=>`<button type="button" data-start="${esc(r.message)}">${esc(r.label)} <span aria-hidden="true">↗</span></button>`).join('');
  const ready=w.inventory.filter(x=>x.kind==='ready').reduce((n,x)=>n+x.available,0);
  $('#workspace-stock').innerHTML=`<div class="data-heading"><h3>Inventory</h3><span>${count(ready)} ready</span></div><ul class="stock-lots">${w.inventory.map(l=>`<li class="${l.kind==='ready'?'ready':'held'}"><span class="stock-label">${esc(l.label)}</span><strong>${count(l.available)}</strong><span>${l.kind==='ready'?'Available':'Held · excluded'}${l.reserved?` · ${count(l.reserved)} reserved`:''}</span><span>${money(l.unitCents)} / unit</span></li>`).join('')||'<li>No inventory rows available.</li>'}</ul>`;
  $('#workspace-delivery').innerHTML=`<div class="data-heading"><h3>Delivery</h3><span>Due ${esc(day(w.deadline))}</span></div><ol class="delivery-timeline">${[...w.shipping].sort((a,b)=>a.arrival.localeCompare(b.arrival)).map(r=>`<li class="${r.arrival>w.deadline?'late':'on-time'}"><span class="delivery-date">${esc(day(r.arrival))}</span><div><strong>${esc(r.name)}</strong><span>${money(r.shippingCents)} shipping · ${r.id==='split'?'Stock + rush rates':`${money(r.unitCents)} / unit`}</span></div><span class="delivery-state">${r.arrival>w.deadline?'After deadline':'On time'}</span></li>`).join('')}</ol>`;
  const notes=state?.notes;const historical=notes?new Set(historicalShipmentPolicyIndexes(notes)):null;
  const rules=notes?notes.map((text,i)=>({text,active:!historical!.has(i)})):w.instructions;
  $('#workspace-rules').innerHTML=`<h3>What the plan must respect</h3><ul>${rules.map(r=>`<li class="${r.active?'active':'historical'}">${r.active?esc(r.text):`<s>${esc(r.text)}</s> <span>Replaced</span>`}</li>`).join('')||'<li>No saved instructions yet. Tell Synth what to remember.</li>'}</ul>`;
  $('#workspace-context').innerHTML=w.context.map(c=>`<div><dt>${esc(c.label)}</dt><dd>${esc(c.value)}<span>${esc(c.detail)}</span></dd></div>`).join('');
  $('#workspace-source').textContent=`Source fingerprint · ${w.sourceSha}`;
  $('#workspace-loading').hidden=true;$('#workspace-content').hidden=false;
}
async function loadWorkspace(){
  const request=++workspaceRequest;$('#workspace-loading').textContent='Reading inventory, delivery rates and saved instructions…';
  try{const r=await fetch('/api/workspace-map',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('Workspace data is unavailable.');const data=await r.json() as WorkspaceMap;if(request!==workspaceRequest)return;
    if(!Array.isArray(data.inventory)||!Array.isArray(data.shipping)||!Array.isArray(data.starterRequests)||!Array.isArray(data.instructions)||!Array.isArray(data.context))throw new Error('Workspace data is incomplete.');
    workspace=data;renderWorkspace();$('#workspace-retry').hidden=true;
  }catch{if(request!==workspaceRequest)return;$('#workspace-loading').textContent='The company data could not be loaded. Retry to explore the source for your next request.';$('#workspace-loading').hidden=false;$('#workspace-retry').hidden=false;}
}
$('#workspace-retry').addEventListener('click',()=>void loadWorkspace());
let hadMessages=false;
function syncWorkspace(){const has=!!state?.messages.length;if(has!==hadMessages){$<HTMLDetailsElement>('#workspace').open=false;hadMessages=has;}renderWorkspace();}

function renderOpening(events:ConversationEvent[],hasMessages:boolean){
  const el=$('#opened'),recall=events.find(e=>e.id==='cognee-recall'),workspace=events.find(e=>e.id==='company-memory');
  if(!state||(!recall&&!workspace)){el.hidden=true;el.innerHTML='';return;}
  const n=state.notes.length,plural=n===1?'':'s';
  const text=recall?`Opened with ${n} remembered company instruction${plural}, retrieved from Cognee (revision ${num(recall.detail,/revision (\d+)/)??'?'})`:`Opened the company workspace with ${n} saved instruction${plural}`;
  el.innerHTML=`<button type="button" data-open="${recall?'cognee':''}">${esc(text)} <span aria-hidden="true">↗</span></button>`;
  el.hidden=false;el.classList.toggle('in-thread',hasMessages);
}
function renderThread(messages:ConversationState['messages'],events:ConversationEvent[]){
  const times=messages.filter(m=>m.role==='assistant').map(m=>Date.parse(m.at));
  const perTurn=times.map(()=>[] as Activity[]);
  for(const e of events){
    if(e.id==='cognee-recall'||e.id==='company-memory'||!times.length)continue;
    const at=Date.parse(e.at);let k=times.findIndex(t=>at<=t+400);if(k<0)k=times.length-1;
    perTurn[k].push(describe(e));
  }
  let turn=-1;
  $('#thread').innerHTML=messages.map(m=>{
    if(m.role==='user')return `<article class="message user"><span class="who">You</span><p>${esc(m.text)}</p></article>`;
    turn++;const acts=perTurn[turn]??[];const latest=turn===times.length-1,fresh=latest&&acts.some(a=>ranNow(a.at));
    const chips=`<div class="receipts${fresh?' fresh':''}" role="group" aria-label="What ran for this reply">${acts.map(chip).join('')}</div>`;
    const receipts=!acts.length?'':latest?chips:`<details class="receipts-past"><summary>What ran · ${esc([...new Set(acts.map(a=>a.name))].join(', '))}</summary>${chips}</details>`;
    return `<article class="message assistant"><span class="who">Synth</span><p>${esc(m.text)}</p>${receipts}</article>`;
  }).join('');
}
function renderArtifacts(){
  const rank=(name:string)=>/^Approved work packet/i.test(name)?0:/^Customer reply|launch|supplier/i.test(name)?1:/ticket/i.test(name)?2:/rocketride/i.test(name)?3:4;
  const artifacts=[...(state?.artifacts??[])].sort((a,b)=>rank(a.name)-rank(b.name));
  const el=$('#artifacts');el.hidden=!artifacts.length;
  el.innerHTML=artifacts.map(a=>{
    const kind=/^Printful sample/i.test(a.name)?'printful':/^Sent demo email/i.test(a.name)?'sent':/^Tenki.*preview/i.test(a.name)?'tenki':/^Gmail draft receipt/i.test(a.name)?'gmail':/^Supplier browser receipt/i.test(a.name)?'browser':rank(a.name)===0?'packet':rank(a.name)===1?'draft':rank(a.name)===2?'ticket':rank(a.name)===3?'cloud':/receipt/i.test(a.name)?'receipt':'file';
    const current=kind==='packet'&&!!state&&isCurrentPacket(state,a),historical=kind==='packet'&&!current;
    const copy={
      printful:['Printful sample order','Draft · unsubmitted','A real supplier draft for one sample. Open its receipt to see the confirmed contents. No purchase or shipment.'],
      sent:['Email sent','Confirmed in Gmail Sent','The approved sample handoff was sent to hello@trusynth.com. Delivery is not independently confirmed.'],
      packet:historical?['Earlier work packet','Historical · unsent','Written for an approval that no longer applies to the current proposal. Kept for the record; nothing was sent.']:['Approved work packet','Unsent · owner approved','Customer reply drafted and the work that still needs a human listed. No message, payment or supplier order was made.'],
      draft:/launch|supplier/i.test(a.name)?['Launch kit','Email + social drafts · not sent','Supplier email and social post drafted from the exact approved packet. Nothing was emailed or posted.']:['Customer reply · draft','Unsent · approval required','Saved locally, not sent. Owner approval is still required before this becomes a work packet.'],
      gmail:['Gmail draft receipt','Unsent · no recipient','The supplier inquiry was saved in the Synth Gmail account. This receipt records the draft; nothing was sent.'],
      browser:['Supplier page receipt','Read-only result','The saved browser result. No forms submitted or supplier orders placed.'],
      receipt:['Hotdata receipt','Per-turn receipt','Database ids, SQL, query run ids and the returned rows for this turn.'],
      cloud:['RocketRide receipt','Cloud verification','Task id, timing, credit delta and the returned proposal used for this approval.'],
      ticket:['Public work ticket','Published · GitHub','A real work ticket published to the fixed public project repository for this approved order. No customer message, payment or supplier order.'],
      tenki:['Cloud workspace','Live · Tenki Cloud','The approved handoff and latest supplier screenshot on the dedicated cloud computer. This temporary preview has a visible expiry.'],
      file:['Saved file','Local','A local file in this demo workspace.']
    }[kind];
    const url=safeUrl(a.url);
    const actions=kind==='packet'||kind==='draft'||kind==='gmail'||kind==='browser'||kind==='sent'||kind==='printful'
      ?`<div class="artifact-actions"><button type="button" class="preview" data-preview="${esc(a.id)}" data-artifact="${esc(a.id)}" data-status="${esc(copy[1])}">Read it here</button>${url?`<a href="${esc(url)}" target="_blank" rel="noreferrer" class="raw">Raw file <span aria-hidden="true">↗</span></a>`:''}</div>`
      :kind==='receipt'
      ?`<div class="artifact-actions"><button type="button" class="preview" data-run="${esc(a.id)}" data-artifact="${esc(a.id)}" aria-expanded="false">Show the run</button>${url?`<a href="${esc(url)}" target="_blank" rel="noreferrer" class="raw">Raw receipt <span aria-hidden="true">↗</span></a>`:''}</div><div class="run" hidden></div>`
      :url?`<a href="${esc(url)}" target="_blank" rel="noreferrer">${kind==='ticket'?'Open the ticket on GitHub':kind==='tenki'?'Open the cloud workspace':'Open the receipt'} <span aria-hidden="true">↗</span></a>`:'';
    return `<article class="artifact ${kind}${historical?' historical':''}"><div class="artifact-head"><span class="kind">${esc(copy[0])}</span><span class="status">${esc(copy[1])}</span></div><strong>${esc(a.name)}</strong><p>${esc(copy[2])}</p>${actions}${kind==='browser'?`<div class="browser-preview" data-browser-receipt="${esc(a.id)}"><p>Reading the saved browser preview…</p></div>`:''}</article>`;
  }).join('');
  el.querySelectorAll<HTMLElement>('[data-browser-receipt]').forEach(box=>{const a=state?.artifacts.find(a=>a.id===box.dataset.browserReceipt);if(a)void renderBrowserPreview(box,a.url);});
}
const browserReceipts=new Map<string,Promise<any>>();
async function renderBrowserPreview(box:HTMLElement,path:string){
  const url=safeUrl(path);if(!url)return;
  try{if(!browserReceipts.has(url))browserReceipts.set(url,fetch(url,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw new Error('Receipt unavailable');return r.json();}));const r=await browserReceipts.get(url);if(!box.isConnected)return;
    const shot=String(r?.screenshot?.path??'');const allowed=/^\/api\/conversation\/browser-shot\/[a-f0-9-]{36}$/.test(shot)&&shot.trim()===shot;
    box.innerHTML=`${allowed?`<a href="${esc(shot)}" target="_blank" rel="noreferrer"><img src="${esc(shot)}" alt="Saved screenshot of the supplier catalog" loading="lazy"></a>`:''}<p><b>${esc(r?.browser?.cdpHost==='Tenki Cloud'?'Tenki Cloud · live read':'Local Chrome · live read')}</b>${r?.page?.title?` · ${esc(r.page.title)}`:''}</p><p>Website information only; stock and pricing for this sample plan are unconfirmed.</p>`;
  }catch{browserReceipts.delete(url);if(box.isConnected)box.textContent='Browser preview unavailable. Open the saved receipt to inspect the result.';}
}
function renderOrder(){
  const el=$('#order'),line=$('#order-line');
  if(!state){el.innerHTML=`<h2 class="order-head">Order DEMO-001 · 100 ${esc(company?.product??workspace?.product??'units')}</h2><p class="order-main">$1,800.00 budget${company?` · deadline ${esc(day(company.deadline))}`:''}</p><p class="order-note">Tell Synth the quantity and budget. It checks stock, delivery and your rules.</p>`;el.dataset.kind='none';line.textContent='Ready when you are';return;}
  const p=state.rehearsal.proposal,a=state.rehearsal.approved,notes=state.notes;
  let kind='none',head='',main='',note='',lineText='';
  if(a){kind='approved';head=`Approved · ${a.quantity} ${company?.product??workspace?.product??'units'}`;main=`${a.option} · ${money(a.totalCents)}`;note='Approved. Create the work packet, then prepare the supplier handoff.';lineText=`Approved · ${a.quantity} ${company?.product??workspace?.product??'units'} · ${a.option} · ${money(a.totalCents)} · nothing sent`;}
  else if(p&&p.chosen){kind='proposal';head=`Proposal · ${p.quantity} ${company?.product??workspace?.product??'units'}`;main=`${p.chosen.name} · ${money(p.chosen.totalCents)} · arrives ${day(p.chosen.arrival)}`;note=`Budget ${money(p.budgetCents)}, ${money(p.budgetCents-p.chosen.totalCents)} left. Awaiting your explicit approval: say “approve” to record it.`;lineText=`Proposal · ${p.quantity} ${company?.product??workspace?.product??'units'} · ${p.chosen.name} · ${money(p.chosen.totalCents)} · awaiting your approval`;}
  else if(p){kind='blocked';head=`No option fits · ${p.quantity} ${company?.product??workspace?.product??'units'}`;main=`Budget ${money(p.budgetCents)}`;note='Nothing meets the deadline, the budget and the company shipment rule together. Change the quantity or the budget.';lineText=`No option fits ${p.quantity} ${company?.product??workspace?.product??'units'} · change the quantity or budget`;}
  else{
    let cleared=false;for(let i=state.events.length-1;i>=0;i--){const id=state.events[i].id;if(id==='local-options')break;if(id==='local-memory'){cleared=true;break;}}
    head=`Order DEMO-001 · ${state.quantity} ${company?.product??workspace?.product??'units'}`;main=`${money(state.budgetCents)} budget${company?` · deadline ${day(company.deadline)}`:''}`;
    note=cleared?'Your latest instruction cleared the proposal. Ask me to review the order again and I will re-check the options under the new rule.':'Tell Synth what changed. It checks three delivery options.';lineText=cleared?'Proposal cleared by your instruction · ask for a review again':'Ready when you are';
  }
  const current=(prefix:RegExp)=>state!.artifacts.some(x=>prefix.test(x.name)&&isCurrentPacket(state!,x));
  const hasPacket=current(/^Approved work packet/i),hasKit=current(/^Launch kit/i),hasTicket=current(/^Published work ticket/i);
  const emailDone=state.events.some(e=>e.id==='project-email-sent');
  const emailAction=a&&hasKit?`<div class="order-actions"><button type="button" class="action" id="send-demo-email" ${busy?'disabled':''}>${emailDone?'Open sent email receipt':'Send demo email to me'}</button><p>To hello@trusynth.com · approved sample handoff</p></div>`:'';
  const actions=a&&hasPacket?`<div class="order-actions">${!hasKit?'<button type="button" class="action" data-work-action data-start="Prepare the launch kit for this order.">Prepare launch kit</button>':!hasTicket?'<button type="button" class="action" data-work-action data-start="Publish work ticket to GitHub.">Publish work ticket</button><p>Posts the approved handoff to the public GitHub project.</p>':'<p>Work ticket published. Email and social copy remain drafts.</p>'}</div>`:'';
  const options=p?`<ul class="options" aria-label="The three fulfillment options">${p.options.map(o=>{
    const chosen=p.chosen?.id===o.id,fits=o.onTime&&o.withinBudget;
    const why=chosen?'chosen':!o.onTime?'too late':!o.withinBudget?'over budget':p.chosen&&o.totalCents<p.chosen.totalCents?'company rule':'costs more';
    return `<li class="${chosen?'chosen':fits?'fits':'out'}"><span class="name">${esc(o.name)}</span><span class="total">${money(o.totalCents)}</span><span class="when">arrives ${esc(day(o.arrival))}</span><span class="why">${why}</span></li>`;}).join('')}</ul>`:'';
  const shown=notes.slice(-4),offset=notes.length-shown.length;
  // The core decides which earlier shipment-policy instructions an actual contradictory instruction superseded.
  const historicalIdx=new Set(historicalShipmentPolicyIndexes(notes));
  const item=(n:string,i:number)=>historicalIdx.has(offset+i)?`<li class="historical"><s>${esc(n)}</s> <span>historical · replaced</span></li>`:`<li>${esc(n)}</li>`;
  const instructions=`<details class="instructions"><summary>Remembered instructions · ${notes.length}</summary>${notes.length?`<ul>${shown.map(item).join('')}${notes.length>shown.length?`<li class="more">and ${notes.length-shown.length} earlier</li>`:''}</ul>`:'<p>None yet. Say “remember” and the instruction.</p>'}</details>`;
  el.innerHTML=`<h2 class="order-head">${esc(head)}</h2><p class="order-main">${esc(main)}</p><p class="order-note">${esc(note)}</p>${actions}${emailAction}${a&&hasKit?'<div class="order-actions"><button type="button" id="save-printful" class="action">Save Printful sample draft</button><p>One sample · saved for review · no purchase</p></div>':''}${options}${instructions}`;
  el.dataset.kind=kind;line.textContent=lineText;
}
function renderActivity(events:ConversationEvent[]){
  const acts=events.map(describe);
  const rows=[...LOCAL_STACK,...SPONSORS.map(s=>({id:s.id,name:s.name,idle:s.idle,open:s.status==='open'}))];
  $('#activity-list').innerHTML=rows.map(row=>{
    let mine=acts.filter(a=>a.key===row.id);
    if(row.id==='whisper'&&voiceRuns.count)mine=[{key:'whisper',name:'Local Whisper',short:`${voiceRuns.count} voice note${voiceRuns.count===1?'':'s'} transcribed on the Mac`,detail:voiceRuns.engine,at:voiceRuns.at,sponsor:null}];
    const last=mine.at(-1),now=!!last&&ranNow(last.at);
    const cls=now?'now':last?'ran':row.open?'off':'idle';
    const text=now&&last?`This turn · ${last.short}`:last?`Ran ${mine.length===1?'once':`${mine.length} times`} · ${last.short}`:row.idle;
    const open=SPONSORS.some(s=>s.id===row.id)?row.id:'';
    return `<li class="${cls}${last?.warn?' warn':''}"><button type="button" data-open="${open}"><span class="dot" aria-hidden="true"></span><b>${esc(row.name)}</b><span class="state">${esc(text)}</span></button></li>`;
  }).join('');
}
function scrollToLatest(){const latest=document.querySelector('.message:last-child');latest?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});}

/* ---------- voice ---------- */
function stopVoice(){
  voiceGeneration++;naturalAudio?.pause();naturalAudio=null;
  if(liveVoice){void liveVoice.stop();liveConnected=false;liveAudio.hidden=true;}
  handsFree=false;cancelRecording=true;speaking=false;window.speechSynthesis?.cancel();
  if(recorder?.state==='recording')recorder.stop();else cleanupMicrophone();
  setVoice('paused','Voice paused. You can keep typing.');updateControls();
}
function cleanupMicrophone(){cancelAnimationFrame(frame);stream?.getTracks().forEach(track=>track.stop());stream=null;void context?.close();context=null;listening=false;updateControls();}
let naturalAudio:HTMLAudioElement|null=null,voiceGeneration=0;
async function speak(text:string){
 const generation=++voiceGeneration;if(muted){if(handsFree)void listen();return;}
 naturalAudio?.pause();setVoice('thinking','Preparing a natural spoken reply…');
 try{const response=await fetch('/api/voice/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Voice unavailable');const blob=await response.blob();if(generation!==voiceGeneration||muted)return;const url=URL.createObjectURL(blob),audio=new Audio(url);naturalAudio=audio;speaking=true;setVoice('speaking','Synth · natural Ava voice');updateControls();const done=()=>{URL.revokeObjectURL(url);if(generation!==voiceGeneration)return;speaking=false;setVoice('off','Ready when you are.');updateControls();if(handsFree&&!busy)void listen();};audio.onended=done;audio.onerror=done;await audio.play();}
 catch{if(generation!==voiceGeneration)return;speaking=false;setVoice('error','Spoken audio is unavailable. Your reply is shown above.');updateControls();}
}

async function sendMessage(message:string){
  if(busy||!message.trim())return;
  busy=true;clearError();$('#working-label').textContent='Thinking through your request…';turnStartedAt=Date.now();updateControls();
  try{
    window.speechSynthesis?.cancel();speaking=false;
    if(!state)await startConversation();
    setVoice('thinking','Your Synth is working on the Mac.');startProgress();
    const result=await api('/api/conversation/turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state!.id,revision:state!.revision,message})});
    state=result.state;busy=false;await stopProgress(true);render();scrollToLatest();speak(result.reply);
  }catch(e){const text=(e as Error).message;busy=false;handsFree=false;progressTurnFailed=true;await stopProgress(true);error(text,/reload/i.test(text));setVoice('error','Ready to try again.');updateControls();}
}
async function submitAudio(blob:Blob){
  if(busy)return;busy=true;clearError();$('#working-label').textContent='Listening back to your voice note…';setVoice('transcribing','Transcribing locally on the Mac.');updateControls();
  try{
    const type=blob.type==='audio/x-m4a'?'audio/mp4':blob.type||'audio/webm';
    const result=await api('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':type},body:blob});
    voiceRuns.count++;voiceRuns.engine=String(result.engine??'local whisper.cpp');voiceRuns.at=new Date().toISOString();
    busy=false;updateControls();await sendMessage(result.text);
  }catch(e){busy=false;handsFree=false;error((e as Error).message);setVoice('error','Try again, or type your message.');updateControls();}
}
async function listen(){
  if(busy||listening||!handsFree)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){handsFree=false;error('This browser cannot record microphone audio. You can attach a voice note or type instead.');setVoice('error','Microphone is unavailable here.');updateControls();return;}
  try{
    window.speechSynthesis?.cancel();speaking=false;cancelRecording=false;
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!handsFree){cleanupMicrophone();return;}
    context=new AudioContext();const analyser=context.createAnalyser();analyser.fftSize=512;context.createMediaStreamSource(stream).connect(analyser);
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
    recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
    const chunks:BlobPart[]=[];let heard=false;let lastSpeech=performance.now();const started=performance.now();
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{const type=recorder?.mimeType??mime??'audio/webm';cleanupMicrophone();if(cancelRecording)return;if(heard)void submitAudio(new Blob(chunks,{type}));else{handsFree=false;setVoice('nospeech','I did not catch speech. Tap Start talking to try again.');updateControls();}};
    recorder.start();listening=true;setVoice('listening','Listening. Pause briefly when you finish your thought.');updateControls();
    const canvas=$<HTMLCanvasElement>('#wave'),draw=canvas.getContext('2d')!,samples=new Uint8Array(analyser.fftSize);
    function meter(){
      if(!listening||!recorder||recorder.state!=='recording')return;
      analyser.getByteTimeDomainData(samples);let sum=0;for(const n of samples)sum+=((n-128)/128)**2;const rms=Math.sqrt(sum/samples.length),now=performance.now();
      if(rms>.014){heard=true;lastSpeech=now;}
      draw.clearRect(0,0,canvas.width,canvas.height);draw.fillStyle='#d8c48e';
      for(let i=0;i<20;i++){const amplitude=Math.abs(samples[i*12]-128)/128;const height=Math.max(2,Math.min(30,amplitude*110));draw.fillRect(i*8,16-height/2,3,height);}
      if((heard&&now-lastSpeech>1300&&now-started>1300)||now-started>25000||(!heard&&now-started>10000)){recorder.stop();return;}
      frame=requestAnimationFrame(meter);
    }meter();
  }catch(e){handsFree=false;cleanupMicrophone();error((e as Error).name==='NotAllowedError'?'Microphone permission is needed for live conversation. Allow it in this site’s browser controls, attach a voice note, or type.':'The microphone could not start. Try attaching a voice note or typing.');setVoice('error','Microphone is off.');updateControls();}
}

/* ---------- evidence dialog ---------- */
const stateWord=(s:SponsorEvidence,ran:number)=>ran?`ran here ${ran===1?'once':`${ran} times`}`:s.status==='open'?'open, not proven':s.status==='verified'?'verified today, not used here':'runs on the next review';
function showProof(sponsor?:string){
  const chosen=sponsor?SPONSORS.find(s=>s.id===sponsor):undefined;
  $('#proof-title').textContent=chosen?chosen.name:'What happened';
  const acts=(state?.events??[]).map(describe);
  const mine=chosen?acts.filter(a=>a.sponsor===chosen.id):acts;
  const intro=`<p class="proof-intro">Apple’s on-device model understands each message on this Mac. Voice notes use local Whisper; spoken replies use a local system voice. Company data, order constraints, procedure replays and company memory go through Hotdata, HydraDB, Rote and Cognee, and each leaves a receipt here. No cloud language model, payment, supplier order or outgoing message. ${esc(EVIDENCE_NOTE)}</p>`;
  const activity=`<h3>In this conversation</h3>${mine.length?`<ol class="proof-events">${mine.slice(-14).map(a=>`<li><b>${esc(a.name)}</b> ${esc(a.short)}<span>${esc(a.detail)}</span><time>${esc(clock(a.at))}</time></li>`).join('')}</ol>`:`<p class="proof-empty">${chosen?`${esc(chosen.name)} has not run in this conversation${chosen.status==='open'?' and is not part of the local order desk':''}.`:'Nothing has run yet. Your first request adds its receipts here.'}</p>`}`;
  const entries=(chosen?[chosen]:SPONSORS).map(s=>{
    const ran=acts.filter(a=>a.sponsor===s.id).length;
    return `<article class="proof-sponsor"><div class="proof-sponsor-head"><h3>${esc(s.name)}</h3><span class="state ${s.status}${ran?' ran':''}">${esc(stateWord(s,ran))}</span></div><p class="role">${esc(s.role)}</p><p>${esc(s.job)}</p><p><b>Verified today.</b> ${esc(s.proof)}</p><p class="gaps-head"><b>Open gaps.</b></p><ul class="gaps">${s.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul><p class="receipt-links">${s.receipts.map(r=>`<a href="/evidence/${esc(r.id)}" target="_blank" rel="noreferrer">${esc(r.label)} <span aria-hidden="true">↗</span></a>`).join('')}</p></article>`;
  }).join('');
  $('#proof-body').innerHTML=intro+activity+(chosen?'':'<h3>Each sponsor: verified today and still open</h3>')+entries;
  dialog.showModal();$('#close-proof').focus();
}

/* ---------- packet preview (fetches the actual saved file) ---------- */
const packetDialog=$<HTMLDialogElement>('#packet');let packetTrigger:HTMLElement|null=null,packetText='',packetName='',packetRequest=0,packetAbort:AbortController|null=null;
async function openPacket(artifact:{id:string;name:string;url:string},trigger:HTMLElement,status:string){
  const url=safeUrl(artifact.url);if(!url)return;
  packetAbort?.abort();const request=++packetRequest,abort=new AbortController();packetAbort=abort;
  packetTrigger=trigger;packetName=artifact.name;packetText='';
  $('#packet-title').textContent=artifact.name;$('#packet-status').textContent=status;$('#packet-raw').setAttribute('href',url);
  const pre=$('#packet-text');pre.textContent='Reading the saved file…';$('#packet-error').hidden=true;
  $<HTMLButtonElement>('#packet-copy').disabled=true;$<HTMLButtonElement>('#packet-download').disabled=true;$('#packet-copy').textContent='Copy';
  packetDialog.showModal();$('#close-packet').focus();
  const timer=setTimeout(()=>abort.abort(),15000);
  try{
    const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw new Error('The saved file could not be read. It may have been removed from this demo workspace.');
    const text=await response.text();
    if(request!==packetRequest||!packetDialog.open)return; // a later open or a close superseded this request
    packetText=text;pre.textContent=text;
    $<HTMLButtonElement>('#packet-copy').disabled=false;$<HTMLButtonElement>('#packet-download').disabled=false;
  }catch(e){
    if(request!==packetRequest||!packetDialog.open)return; // stale failure or abort: ignore
    pre.textContent='';$('#packet-error').textContent=(e as Error).name==='AbortError'?'Reading the saved file took too long. Try again.':(e as Error).message;$('#packet-error').hidden=false;
  }finally{clearTimeout(timer);}
}
$('#packet-copy').addEventListener('click',async()=>{const b=$<HTMLButtonElement>('#packet-copy');try{await navigator.clipboard.writeText(packetText);b.textContent='Copied';}catch{b.textContent='Copy unavailable';}setTimeout(()=>{b.textContent='Copy';},1800);});
$('#packet-download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([packetText],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download=`${packetName.replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'packet'}.md`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);});
$('#close-packet').addEventListener('click',()=>packetDialog.close());
packetDialog.addEventListener('click',e=>{if(e.target===packetDialog)packetDialog.close();});
packetDialog.addEventListener('close',()=>{packetAbort?.abort();packetRequest++;packetText='';packetTrigger?.focus();packetTrigger=null;});
document.addEventListener('click',e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-preview]');if(!target||!state)return;const artifact=state.artifacts.find(a=>a.id===target.dataset.preview);if(artifact)void openPacket(artifact,target,target.dataset.status??'');});

/* ---------- live sponsor stage (root's GET /api/conversation/progress; polled only while a turn is busy) ---------- */
interface ProgressStep { id:string; sponsor:string; task:string; status:'running'|'complete'|'error'|'reused'; startedAt:string; finishedAt?:string; detail?:string }
interface Progress { conversationId:string; runId:string; active:boolean; steps:ProgressStep[]; updatedAt:string }
const TILES=[{id:'hotdata',name:'Hotdata',logo:'/sponsors/hotdata.svg'},{id:'hydradb',name:'HydraDB',logo:'/sponsors/hydradb.png'},{id:'rote',name:'Rote · Modiqo',logo:'/sponsors/rote.png'},{id:'cognee',name:'Cognee',logo:'/sponsors/cognee.svg'},{id:'rocketride',name:'RocketRide',logo:'/sponsors/rocketride.svg'},{id:'snyk',name:'Snyk',logo:'/sponsors/snyk.svg'}];
let progressPoll=0,progressTurnFailed=false;
let progress:Progress|null=null,progressTimer=0,progressUnavailable=false,liveText='',progressRun=0,progressAbort:AbortController|null=null;const logoMissing=new Set<string>();
const tileOf=(sponsor:string)=>TILES.find(x=>sponsor.toLowerCase().includes(x.id))?.id??null;
const TOOL_NAMES:Record<string,string>={apple:'On-device model',desk:'Order desk',github:'GitHub',gmail:'Gmail',browser:'Supplier browser',tenki:'Tenki Cloud',local:'Order desk'};
const stepName=(sponsor:string)=>TILES.find(x=>x.id===tileOf(sponsor))?.name??TOOL_NAMES[sponsor.toLowerCase()]??sponsor;
let lastLiveHeight=0;
const elapsed=(s:ProgressStep)=>duration(Math.max(0,(s.finishedAt?Date.parse(s.finishedAt):Date.now())-Date.parse(s.startedAt)));
async function pollProgress(){
  // Each poll is bound to the conversation id and the current run generation; anything older is discarded.
  if(!state||progressUnavailable)return;
  const run=progressRun,id=state.id,poll=++progressPoll;progressAbort?.abort();const abort=new AbortController();progressAbort=abort;const timer=setTimeout(()=>abort.abort(),1500);
  try{const r=await fetch(`/api/conversation/progress?id=${encodeURIComponent(id)}`,{signal:abort.signal});
    if(run!==progressRun||state?.id!==id||poll!==progressPoll)return;
    if(r.status===404)progressUnavailable=true;else if(r.ok){const p=await r.json() as Progress;if(run===progressRun&&state?.id===id&&poll===progressPoll&&Array.isArray(p?.steps)&&p.conversationId===id&&(!progress||Date.parse(p.updatedAt)>=Date.parse(progress.updatedAt))){progress=p;return true;}}
  }catch{}finally{clearTimeout(timer);}
}
function revealAboveComposer(el:HTMLElement){if(el.hidden)return;const rect=el.getBoundingClientRect(),composerTop=$('.composer-area').getBoundingClientRect().top;const overflow=rect.bottom-(composerTop-12);if(overflow>0)window.scrollBy({top:overflow,behavior:'instant'});else if(rect.top<8)window.scrollBy({top:rect.top-8,behavior:'instant'});}
function revealLive(){revealAboveComposer($('#live'));}
function startProgress(){clearTimeout(progressTimer);progressAbort?.abort();progressRun++;progress=null;progressUnavailable=false;progressFinalMissing=false;progressTurnFailed=false;lastLiveHeight=0;renderLive();const run=progressRun;const tick=async()=>{if(!busy||run!==progressRun)return;await pollProgress();if(run!==progressRun)return;renderLive();if(busy&&run===progressRun)progressTimer=window.setTimeout(tick,400);};progressTimer=window.setTimeout(tick,120);}
let progressFinalMissing=false;
async function stopProgress(final=true){clearTimeout(progressTimer);progressTimer=0;progressAbort?.abort();progressRun++;if(final&&state&&!progressUnavailable)progressFinalMissing=!(await pollProgress());progressAbort?.abort();progressRun++;renderLive();}
function renderLive(){
  const live=$('#live'),steps=progress?.steps??[];
  const show=busy||steps.length>0||progressTurnFailed||progressFinalMissing;live.hidden=!show;if(!show)return;
  live.classList.toggle('busy',busy);
  // After the turn has ended nothing can still be running: leftover "running" steps are shown as unfinished, never animated.
  const view=busy?steps:steps.map(s=>s.status==='running'?{...s,status:'error' as const,detail:s.detail??'The turn ended before this step reported a result.'}:s);
  const running=view.filter(s=>s.status==='running'),errors=view.filter(s=>s.status==='error');
  const text=running.length?`${stepName(running[running.length-1].sponsor)}: ${running[running.length-1].task}`:busy?(steps.length?'Finishing…':progressUnavailable?'Working on the Mac…':'Connecting…'):progressTurnFailed?'Request failed · review the message below':progressFinalMissing?'Final progress unavailable · showing last reported steps':errors.length?`The turn ended with ${errors.length} unfinished or failed step${errors.length===1?'':'s'}`:steps.length?`Done · ${steps.length} step${steps.length===1?'':'s'}`:progressUnavailable||progressFinalMissing?'No progress record for this turn':'';
  if(text!==liveText){liveText=text;$('#live-status').textContent=text;}
  const list=$('#live-tiles');
  if(list.children.length!==TILES.length)list.innerHTML=TILES.map(tile=>`<li class="tile idle"><button type="button" data-open="${tile.id}" aria-label="${esc(tile.name)}"><span class="logo"><img src="${esc(tile.logo)}" alt="" width="40" height="40" data-logo="${tile.id}"><span class="logo-text">${esc(tile.name)}</span></span><span class="tile-name">${esc(tile.name)}</span><span class="tile-state"></span><span class="tile-bar" aria-hidden="true"></span></button></li>`).join('');
  TILES.forEach((tile,i)=>{
    const li=list.children[i] as HTMLElement,button=li.querySelector('button')!,stateEl=li.querySelector<HTMLElement>('.tile-state')!;
    const mine=view.filter(s=>tileOf(s.sponsor)===tile.id),current=mine.find(s=>s.status==='running')??mine[mine.length-1];
    const status=mine.some(s=>s.status==='running')?'running':mine.some(s=>s.status==='error')?'error':mine.some(s=>s.status==='complete')?'complete':mine.some(s=>s.status==='reused')?'reused':'idle';
    const build=tile.id==='snyk';
    const label=build?'scanned at build time':status==='running'?`${current!.task} · ${elapsed(current!)}`:status==='complete'?`done · ${mine.length} step${mine.length===1?'':'s'}`:status==='reused'?'reused verified result':status==='error'?(busy?'error':'Needs review'):'';
    const cls=`tile ${build?'build':status}${logoMissing.has(tile.id)?' no-logo':''}`;
    if(li.className!==cls)li.className=cls;
    if(stateEl.textContent!==label)stateEl.textContent=label;
    const aria=`${tile.name}${label?': '+label:''}`;if(button.getAttribute('aria-label')!==aria)button.setAttribute('aria-label',aria);
  });
  list.querySelectorAll<HTMLImageElement>('img[data-logo]:not([data-bound])').forEach(img=>{img.dataset.bound='1';img.addEventListener('error',()=>{logoMissing.add(img.dataset.logo!);img.closest('.tile')?.classList.add('no-logo');img.remove();},{once:true});});
  const stepsHtml=view.map(s=>`<li class="${esc(s.status)}"><b>${esc(stepName(s.sponsor))}</b> ${esc(s.task)} <span class="step-state">${esc(s.status)} · ${esc(elapsed(s))}</span>${s.detail?`<span class="step-detail">${esc(s.detail)}</span>`:''}</li>`).join('')||'<li class="idle">No steps reported yet.</li>';
  const stepsEl=$('#live-steps');if(stepsEl.innerHTML!==stepsHtml)stepsEl.innerHTML=stepsHtml;
  if(busy){const height=live.getBoundingClientRect().height;if(Math.abs(height-lastLiveHeight)>4){lastLiveHeight=height;revealLive();}}
}
$('#live-toggle').addEventListener('click',()=>{const open=$('#live-toggle').getAttribute('aria-expanded')==='true';$('#live-toggle').setAttribute('aria-expanded',String(!open));$('#live-steps').hidden=open;});

/* ---------- Hotdata completed-run view (actual per-turn receipt, fetched read-only) ---------- */
interface DataReceipt { engine:string; startedAt:string; finishedAt:string; queryOverlapMs:number; paidCalls:number|null; failure?:string; reusedFrom?:string; sourceQueriedAt?:string; isolationProbe?:{databaseId:string;foreignCatalog:string;denied:boolean;status:number}; workers:{role:string;databaseId:string;catalog:string;rows:number;queryRunId?:string;startedAt:string;finishedAt:string;destroyed:boolean}[] }
const runCache=new Map<string,Promise<DataReceipt>>();
async function showRun(button:HTMLButtonElement){
  const card=button.closest<HTMLElement>('.artifact'),box=card?.querySelector<HTMLElement>('.run');if(!card||!box)return;
  const open=button.getAttribute('aria-expanded')==='true';
  if(open){box.hidden=true;button.setAttribute('aria-expanded','false');button.textContent='Show the run';card.classList.remove('expanded');return;}
  button.setAttribute('aria-expanded','true');button.textContent='Hide the run';card.classList.add('expanded');box.hidden=false;
  const artifact=state?.artifacts.find(a=>a.id===button.dataset.run),url=artifact?safeUrl(artifact.url):'';
  if(!url){box.innerHTML='<p class="run-foot">This receipt is not available.</p>';return;}
  box.innerHTML='<p class="run-foot">Reading the saved receipt…</p>';
  try{
    if(!runCache.has(url))runCache.set(url,fetch(url,{signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw new Error('The receipt could not be read.');return r.json() as Promise<DataReceipt>;}));
    const receipt=await runCache.get(url)!;renderRun(box,receipt);
  }catch(e){runCache.delete(url);box.innerHTML=`<p class="run-foot warn">${esc((e as Error).message)}</p>`;}
}
function renderRun(box:HTMLElement,r:DataReceipt){
  const workers=(r.workers??[]).filter(w=>w.startedAt&&w.finishedAt);
  const lifecycle=Date.parse(r.finishedAt)-Date.parse(r.startedAt);
  if(r.engine!=='Hotdata'||!workers.length){
    box.innerHTML=`<p class="run-head"><b>${esc(r.engine==='verified Hotdata snapshot'?'Verified snapshot reused':'Local company files')}</b> · ${esc(r.engine==='verified Hotdata snapshot'?`the Hotdata result from ${clock(r.sourceQueriedAt??'')} was under five minutes old, so no new databases were created for this turn`:'Hotdata was not used for this turn')}.</p>`;return;
  }
  const starts=workers.map(w=>Date.parse(w.startedAt)),ends=workers.map(w=>Date.parse(w.finishedAt));
  const t0=Math.min(...starts),t1=Math.max(...ends),span=Math.max(1,t1-t0),o0=Math.max(...starts),o1=Math.min(...ends);
  const order=['inventory','shipping','policy'];workers.sort((a,b)=>order.indexOf(a.role)-order.indexOf(b.role));
  box.innerHTML=`<p class="run-head"><b>Completed run</b> · queries started ${esc(clock(workers[0].startedAt))} · ${esc(duration(lifecycle))} create-load-query-delete lifecycle · three concurrent SQL tasks, each on its own Hotdata database, issued by the local coordinator (not RocketRide agents)</p><ol class="lanes" aria-label="Query interval per worker">${workers.map(w=>`<li class="lane"><span class="lane-name">${esc(w.role)}</span><span class="lane-track" title="${esc(clock(w.startedAt))} → ${esc(clock(w.finishedAt))}"><span class="lane-overlap"></span><span class="lane-bar"></span></span><span class="lane-meta">${w.rows} row${w.rows===1?'':'s'} · ${esc(duration(Date.parse(w.finishedAt)-Date.parse(w.startedAt)))} · ${esc(w.catalog)} · ${esc(w.queryRunId??'no run id')} · ${w.destroyed?'deleted':'not confirmed deleted'}</span></li>`).join('')}</ol><p class="run-foot">${o1>o0?`All three requests were in flight together for <b>${esc(duration(r.queryOverlapMs))}</b> (brass band); this is a measured overlap, not a speedup.`:'The three requests did not overlap in this run.'} ${r.isolationProbe?`Isolation: the inventory database asked for the shipping catalog and was <b>${r.isolationProbe.denied?'denied':'not denied'}</b> (HTTP ${r.isolationProbe.status}).`:''} ${workers.every(w=>w.destroyed)?`<b>${workers.length} of ${workers.length}</b> databases deleted.`:'Cleanup not fully confirmed.'} ${r.paidCalls===0?'0 paid calls.':''}${r.failure?` <span class="warn">${esc(r.failure)}</span>`:''}</p>`;
  box.querySelectorAll<HTMLElement>('.lane').forEach((lane,i)=>{const w=workers[i],bar=lane.querySelector<HTMLElement>('.lane-bar')!,ov=lane.querySelector<HTMLElement>('.lane-overlap')!;
    bar.style.left=`${((Date.parse(w.startedAt)-t0)/span*100).toFixed(2)}%`;bar.style.width=`${Math.max(1,(Date.parse(w.finishedAt)-Date.parse(w.startedAt))/span*100).toFixed(2)}%`;
    if(o1>o0){ov.style.left=`${((o0-t0)/span*100).toFixed(2)}%`;ov.style.width=`${((o1-o0)/span*100).toFixed(2)}%`;}else ov.hidden=true;});
}
document.addEventListener('click',e=>{const target=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-run]');if(target)void showRun(target);});

/* ---------- wiring ---------- */
document.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest('#send-demo-email');if(!b||busy||!state)return;void (async()=>{busy=true;clearError();updateControls();try{const result=await api('/api/handoff/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state!.id,revision:state!.revision})});state=result.state;render();scrollToLatest();speak(result.reply);}catch(e){error((e as Error).message);}finally{busy=false;updateControls();}})();});
document.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest('#save-printful');if(!b||busy||!state)return;void (async()=>{busy=true;clearError();updateControls();try{const result=await api('/api/handoff/printful',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state!.id,revision:state!.revision})});state=result.state;render();scrollToLatest();speak(result.reply);}catch(e){error((e as Error).message);}finally{busy=false;updateControls();}})();});
$('#talk').addEventListener('click',()=>{if(liveConnected){stopVoice();return;}if(liveEnabled&&$<HTMLSelectElement>('#voice-mode').value==='gpt'){void startLiveVoice().catch(e=>{liveConnected=false;error((e as Error).message);updateControls();});return;}if(handsFree||listening||speaking){stopVoice();return;}handsFree=true;clearError();updateControls();if(!busy)void listen();});
$('#mute').addEventListener('click',()=>{muted=!muted;$('#mute').textContent=muted?'Voice off':'Voice on';$('#mute').setAttribute('aria-pressed',String(muted));$('#mute').setAttribute('aria-label',muted?'Turn spoken replies on':'Turn spoken replies off');liveAudio.muted=muted;if(naturalAudio)naturalAudio.muted=muted;if(muted){window.speechSynthesis?.cancel();speaking=false;if(voiceState==='speaking')setVoice('off','Spoken replies are off.');updateControls();}});
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();const input=$<HTMLTextAreaElement>('#message'),text=input.value.trim();if(!text||busy)return;input.value='';void sendMessage(text);});
$('#message').addEventListener('keydown',e=>{const event=e as KeyboardEvent;if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();$<HTMLFormElement>('#chat-form').requestSubmit();}});
document.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-start]');if(button&&!button.disabled)void sendMessage(button.dataset.start!);});
$('#attach').addEventListener('click',()=>$<HTMLInputElement>('#voice-file').click());
$('#voice-file').addEventListener('change',()=>{const input=$<HTMLInputElement>('#voice-file'),file=input.files?.[0];input.value='';if(!file)return;if(file.size>4_000_000){error('Choose a voice note under 4 MB and 30 seconds.');return;}stopVoice();void submitAudio(file);});
$('#new-chat').addEventListener('click',async()=>{if(busy)return;busy=true;stopVoice();clearError();try{await startConversation();window.scrollTo({top:0,behavior:'instant'});}catch(e){error((e as Error).message);}finally{busy=false;updateControls();}});
$('#error-reload').addEventListener('click',()=>{clearError();void restore();});
$('#sponsor-links').innerHTML=SPONSORS.map(s=>`<button type="button" data-sponsor="${s.id}" class="${esc(s.status)}" aria-label="${esc(s.name)}: ${esc(s.tag)}"><i aria-hidden="true"></i>${esc(s.name)}</button>`).join('');
document.addEventListener('click',e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-open],[data-sponsor]');if(!target)return;showProof(target.dataset.open||target.dataset.sponsor||undefined);});
$('#show-work').addEventListener('click',()=>showProof());$('#all-proof').addEventListener('click',()=>showProof());$('#close-proof').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open&&!packetDialog.open&&(listening||speaking||handsFree))stopVoice();});
window.addEventListener('pagehide',stopVoice);

async function restore(){
  const [conversation,info]=await Promise.allSettled([
    (async()=>{let id:string|null=null;try{id=sessionStorage.getItem('tru-conversation-id');}catch{}return id?await api(`/api/conversation?id=${encodeURIComponent(id)}`) as ConversationState:null;})(),
    api('/api/company') as Promise<{data:Company}>
  ]);
  if(conversation.status==='fulfilled')state=conversation.value;else forget();
  if(info.status==='fulfilled'&&info.value?.data)company={name:String(info.value.data.name),deadline:String(info.value.data.deadline),product:String(info.value.data.product??workspace?.product??'units'),sampleData:info.value.data.sampleData!==false};
  busy=false;render();
}
void restore();void loadWorkspace();window.speechSynthesis?.getVoices();

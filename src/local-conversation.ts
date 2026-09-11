import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import { applyIntent, newConversation, refreshCompanyContext, sanitizeIntent, type ConversationState, type Intent } from './conversation-model.ts';
import { StateError } from './state.ts';
import { CompanyWorkspace, companyData, validateCompany } from './company-workspace.ts';
import { runDataWorkers } from './data-workers.ts';
import { saveCognee, recallCognee } from './cognee-memory.ts';
import { graphConstraints, reviewProcedure, packetProcedure } from './local-procedures.ts';
import { cloudReviewCrossCheck, readAllowance as readCloudAllowance } from './rocketride-cloud.ts';
import { reviewFingerprint, hasCurrentCloudReview } from './approval-proof.ts';
import { beginProgress, type ProgressRun } from './live-progress.ts';
import {prepareLaunchKit,publishWorkTicket} from './work-ticket.ts';
import {createPrintfulDraft} from './printful-draft.ts';
import {sendProjectEmail} from './project-email.ts';
import {createGmailDraft,gmailDraftEnabled} from './gmail-draft.ts';
import {readSupplierPage} from './browser-actions.ts';
import {readTenkiSupplier,uploadTenkiLaunchKit} from './tenki-browser.ts';

const ROOT=process.env.TRU_PLAN_OUTPUT??`${process.cwd()}/run`;
const DATA=`${ROOT}/conversation`;
const MODEL=process.env.TRU_LOCAL_MODEL??`${ROOT}/bin/synth-local-model`;
const WHISPER=process.env.TRU_WHISPER_MODEL??`${process.cwd()}/models/ggml-large-v3-turbo-q5_0.bin`;
const VAD=process.env.TRU_WHISPER_VAD??`${process.cwd()}/models/ggml-silero-v6.2.0.bin`;
const run=promisify(execFile);
const workspace=new CompanyWorkspace(`${DATA}/company`);
let turnBusy=false, audioBusy=false;
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
async function persist(state:ConversationState) {
  await mkdir(`${DATA}/sessions`,{recursive:true});
  const target=`${DATA}/sessions/${state.id}.json`, pending=`${target}.${randomUUID()}.new`;
  await writeFile(pending,JSON.stringify(state,null,2)+'\n',{mode:0o600}); await rename(pending,target);
}
export async function getConversation(id:unknown):Promise<ConversationState> {
  if(!validId(id)) throw new StateError(400,'Start a new conversation.');
  try {return JSON.parse(await readFile(`${DATA}/sessions/${id}.json`,'utf8'));}
  catch {throw new StateError(404,'That local conversation is unavailable. Start a new one.');}
}
export async function createConversation() {
  if(turnBusy)throw new StateError(429,'Finish the current turn before opening another conversation.');
  turnBusy=true;let progress:ProgressRun|undefined;
  try{
    const state=newConversation(randomUUID()),source=await companyData(`${DATA}/company/data.json`);
    progress=beginProgress(state.id);
    let memory=await workspace.read();const recalled=await progress.run('cognee','Recall this company’s instructions',()=>recallCognee()).catch(()=>null);
    if(recalled&&recalled.memory.revision>=memory.revision){
      const priorRevision=memory.revision;memory=await workspace.restoreIfNewer(recalled.memory);
      state.events.push({id:'cognee-recall',label:'Retrieved company instructions from Cognee',detail:`Dataset ${recalled.datasetId}; document ${recalled.dataId}; revision ${recalled.memory.revision}. ${memory.revision>priorRevision?'Restored newer memory to the local working cache.':'The local working cache already has this revision.'} Raw dataset retrieval; no graph-completion model call.`,at:new Date().toISOString()});
    }
    state.notes=memory.notes;state.companyName=source.data.name;state.source=source.data.source;
    state.events.push({id:'company-memory',label:'Opened the company workspace',detail:`${memory.notes.length} saved instructions and ${memory.approvals.length} previous approved proposals. Company data ${source.sha256.slice(0,12)}.`,at:new Date().toISOString()});
    await persist(state);return state;
  }finally{turnBusy=false;progress?.end();}
}
export async function getCompany(){const source=await companyData(`${DATA}/company/data.json`);return {...source,memory:await workspace.read()};}
function localModel(mode:'interpret'|'reply',prompt:string):Promise<Record<string,unknown>> {
  return new Promise((resolve,reject)=>{
    const child=spawn(MODEL,[],{stdio:['pipe','pipe','pipe']}); let output='',finished=false;
    const timer=setTimeout(()=>{child.kill('SIGTERM'); finish(new StateError(504,'The local model took too long. Please try a shorter request.'));},45000);
    function finish(error?:Error) {if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);}
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>64000){child.kill('SIGTERM');finish(new StateError(503,'The local model response was too large.'));}});
    child.stderr.resume();
    child.on('error',()=>finish(new StateError(503,'The local voice model needs to be built. Your conversation is saved.')));
    child.on('close',code=>{
      if(finished)return;
      if(code!==0){finish(new StateError(503,'The on-device model could not complete the request.'));return;}
      try {const result=JSON.parse(output);if(result.error){finish(new StateError(503,'The on-device model could not complete the request. Check that Apple Intelligence is available, then try again.'));return;}finished=true;clearTimeout(timer);resolve(result);}
      catch{finish(new StateError(503,'The local model returned an unreadable response. Please try again.'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({mode,prompt}));
  });
}
export async function conversationTurn(payload:unknown) {
  if(!payload||typeof payload!=='object')throw new StateError(400,'Provide a message.');
  const p=payload as {id:unknown;revision:unknown;message:unknown};
  if(typeof p.message!=='string'||!p.message.trim()||p.message.length>2000)throw new StateError(400,'Use a message between 1 and 2,000 characters.');
  if(turnBusy)throw new StateError(429,'The local model is finishing another turn. Try again in a moment.');
  turnBusy=true;
  let failedReview:ConversationState|undefined,progress:ProgressRun|undefined;
  try {
    let previous=await getConversation(p.id);
    if(p.revision!==previous.revision)throw new StateError(409,'This conversation changed. Reload it before sending again.');
    progress=beginProgress(previous.id);
    const memory=await workspace.read(),source=await companyData(`${DATA}/company/data.json`);
    previous=refreshCompanyContext(previous,source.sha256,memory.notes);
    const context={latestUserMessage:p.message,companyData:source.data,currentOrder:{quantity:previous.quantity,budgetDollars:previous.budgetCents/100,deadline:source.data.deadline,proposal:previous.rehearsal.proposal,approval:previous.rehearsal.approved},notes:previous.notes,priorApprovedProposals:memory.approvals.slice(-4),history:previous.messages.slice(-6)};
    const started=Date.now();
    const interpreted=await progress.run('apple','Understand your request on this Mac',()=>localModel('interpret',JSON.stringify({latestUserMessage:p.message,currentQuantity:previous.quantity}))) as unknown as Intent;
    const intent=sanitizeIntent(interpreted,p.message);
    if(['launch','publish'].includes(intent.action)&&((intent.quantity!=null&&intent.quantity!==previous.quantity)||(intent.budgetDollars!=null&&Math.round(intent.budgetDollars*100)!==previous.budgetCents)))throw new StateError(422,'Review and approve that changed order before preparing or publishing its handoff.');
    if(intent.action==='review'||(['approve','draft'].includes(intent.action)&&((intent.quantity!=null&&intent.quantity!==previous.quantity)||(intent.budgetDollars!=null&&Math.round(intent.budgetDollars*100)!==previous.budgetCents)))){
      failedReview=structuredClone(previous);failedReview.rehearsal.approved=null;failedReview.rehearsal.proposal=null;failedReview.cloudReview=null;failedReview.approvalRevision=null;
    }
    let business=source.data;
    if(['review','approve','draft'].includes(intent.action)&&(intent.action==='review'||intent.quantity!=null||intent.budgetDollars!=null)){
      let facts;try{facts=await runDataWorkers(DATA,business,previous.notes,source.sha256,undefined,event=>progress!.record(event.id,'hotdata',event.task,event.status,event.detail));}catch{throw new StateError(503,'Hotdata could not complete this review. Check the connection and remaining free-run allowance, then review again.');}business=validateCompany(facts.company);previous.notes=facts.notes;
      previous.events.push({id:'company-data',label:`Read the company data · ${facts.receipt.engine}`,detail:`Source ${source.sha256.slice(0,12)}; ${facts.receipt.workers.length} Hotdata databases; ${facts.receipt.queryOverlapMs} ms SQL overlap.${facts.receipt.reusedFrom?` Reused verified source ${facts.receipt.reusedFrom} from ${facts.receipt.sourceQueriedAt}; no fresh Hotdata call.`:''} Receipt ${facts.receipt.id}.`,at:new Date().toISOString()});
      previous.artifacts.push({id:facts.receipt.id,name:'Data-source receipt',url:`/api/conversation/receipt/${facts.receipt.id}`});
    }
    previous.dataRevision=source.sha256;previous.companyName=business.name;previous.source=business.source;
    let applied;
    try {applied=applyIntent(previous,intent,p.message,business);}
    catch(error){throw new StateError(422,(error as Error).message);}
    const state=applied.state;
    if(applied.events.some(e=>e.id==='local-options')){
      let graph;try{graph=await progress.run('hydradb','Read the order’s deadline and shipment rules',()=>graphConstraints(business,state.notes));}catch{throw new StateError(503,'The local HydraDB constraints could not be read. Restore the local service, then review again.');}
      const deadline=graph.rows.find(r=>r.kind==='deadline')?.value,policy=graph.rows.find(r=>r.kind==='policy')?.value;
      if(!deadline||policy===undefined)throw new StateError(503,'HydraDB did not return the required company constraints.');
      business={...business,deadline};state.notes=policy?policy.split('\n'):[];
      const replay=await progress.run('rote','Replay the captured order-review Play',()=>reviewProcedure(business,state.notes,state.quantity,state.budgetCents));
      if(JSON.stringify(replay.proposal)!==JSON.stringify(state.rehearsal.proposal))throw new StateError(503,'The replayed quote disagrees with the current proposal. Approval is paused.');
      state.rehearsal.proposal=replay.proposal;
      state.events.push({id:'hydra-constraints',label:'Queried the order constraints in HydraDB',detail:`Order node ${graph.orderNode}; ${graph.rows.length} returned constraints, used by the review Play; ${graph.ms} ms.`,at:new Date().toISOString()},{id:'rote-review',label:'Replayed the captured order-review procedure',detail:`${replay.receipt.engine}; ${replay.receipt.runId}; ${replay.receipt.ms} ms; no exploratory model wake.`,at:new Date().toISOString()});
      // The enabled cloud verdict governs the returned proposal; failure cannot silently fall back.
      try {
        const cloudWork=()=>cloudReviewCrossCheck(DATA,business,state.notes,state.quantity,state.budgetCents,replay.proposal);
        const cloud=(await readCloudAllowance(DATA))?.enabled?await progress.run('rocketride','Verify this proposal in the cloud and close the task',cloudWork):await cloudWork();
        if(!cloud.skipped){
          if(!cloud.agrees)throw new StateError(503,'The RocketRide cloud check disagrees with the current quote. Approval is paused.');
          state.rehearsal.proposal=cloud.proposal;
          state.cloudReview={fingerprint:reviewFingerprint(state,business),receiptId:cloud.receipt.id};
          state.events.push({id:'rocketride-review',label:'Verified the proposal in RocketRide Cloud',detail:`${cloud.receipt.engine}; task ${cloud.receipt.taskId}; ${cloud.receipt.ms} ms; task terminated ${cloud.receipt.terminated}. Credit balance delta ${cloud.receipt.credits.unitsUsed??'not posted'} grant units; no model call. The returned cloud proposal is required for this approval. Receipt ${cloud.receipt.id}.`,at:new Date().toISOString()});
          state.artifacts.push({id:cloud.receipt.id,name:'RocketRide cloud receipt',url:`/api/conversation/receipt/${cloud.receipt.id}`});
        }
      }catch(error){
        if(error instanceof StateError)throw error;
        throw new StateError(503,'RocketRide could not verify this proposal; approval is paused. Check the service and free-run allowance, then review again.');
      }
    }
    if((applied.events.some(e=>e.id==='local-approval')||applied.draft)&&(await readCloudAllowance(DATA))?.enabled&&!hasCurrentCloudReview(state,business))
      throw new StateError(422,'Please review the current order again before approving or drafting it. Its RocketRide check is missing or no longer matches.');
    let reply=applied.reply;
    if(intent.action==='launch'||intent.action==='publish'){
      if((await readCloudAllowance(DATA))?.enabled&&!hasCurrentCloudReview(state,business))throw new StateError(422,'Review and approve the current order before preparing its launch kit. The cloud verification must still match.');
      let kit;try{kit=prepareLaunchKit(state,business);}catch(error){throw new StateError(422,(error as Error).message);}
      if(intent.action==='launch'){
        const artifactId=randomUUID();await mkdir(`${DATA}/drafts`,{recursive:true});
        await progress.run('desk','Prepare the supplier inquiry and social-post preview',()=>writeFile(`${DATA}/drafts/${artifactId}.md`,kit.markdown,{mode:0o600}));
        state.artifacts.push({id:artifactId,name:`Launch kit · ${state.quantity} shirts`,url:`/api/conversation/artifact/${artifactId}`,approvalRevision:state.approvalRevision!,approval:{...state.rehearsal.approved!}});
        state.events.push({id:'launch-kit',label:'Prepared the supplier email and social post',detail:'Two drafts in one saved preview, based on the exact approved packet. No email or social-network post was sent.',at:new Date().toISOString()});
        reply='Your launch kit is ready: a supplier inquiry, social-post draft, and the production handoff. Open the preview to review both drafts. I can publish the approved work ticket to this project’s GitHub board when you ask.';
        try{
          const gmail=await gmailDraftEnabled(DATA)?await progress.run('gmail','Save the supplier inquiry as an unsent Gmail draft',()=>createGmailDraft(DATA,kit)):null;
          if(gmail){const receiptId=randomUUID();await mkdir(`${DATA}/receipts`,{recursive:true});await writeFile(`${DATA}/receipts/${receiptId}.json`,JSON.stringify(gmail,null,2),{mode:0o600});state.artifacts.push({id:receiptId,name:'Gmail draft receipt · unsent',url:`/api/conversation/receipt/${receiptId}`,approvalRevision:state.approvalRevision!,approval:{...state.rehearsal.approved!}});state.events.push({id:'gmail-draft',label:'Saved the supplier email to Gmail drafts',detail:`Draft ${gmail.draftId}; Synth account; no recipient and no send. ${gmail.reused?'Existing draft reused.':'New draft confirmed.'}`,at:new Date().toISOString()});reply+=' The supplier inquiry is also saved as a real, unsent Gmail draft with no recipient.';}
        }catch{state.events.push({id:'gmail-draft-pending',label:'Gmail draft not confirmed',detail:'The local launch kit is saved; verify Gmail before retrying an uncertain draft creation.',at:new Date().toISOString()});reply+=' The Gmail copy was not confirmed; the saved local preview is ready.';}
        const cloud=await uploadTenkiLaunchKit(DATA,state,business,kit,{progress:(status,detail)=>progress!.record('tenki-upload','tenki','Upload the approved launch kit',status,detail)});
        if(cloud){const id=randomUUID();await mkdir(`${DATA}/receipts`,{recursive:true});await writeFile(`${DATA}/receipts/${id}.json`,JSON.stringify(cloud,null,2),{mode:0o600});state.artifacts.push({id,name:'Tenki Cloud preview · approved handoff',url:cloud.url,approvalRevision:state.approvalRevision!,approval:{...state.rehearsal.approved!}});state.events.push({id:'tenki-upload',label:'Uploaded the approved launch kit to Tenki Cloud',detail:`${cloud.url}; exact approval ${cloud.fingerprint}; temporary preview expires ${cloud.expiresAt}; email and social copy remain unsent drafts.`,at:new Date().toISOString()});reply+=' The exact approved launch kit is also available in the temporary Tenki Cloud preview.';}
      }else{
        const explicit=/\b(publish|post|create)\b/i.test(p.message)&&/\b(work ticket|github|production ticket)\b/i.test(p.message)&&!/\b(do not|don['’]?t|never|not|hold|cancel|can|could|would|should|why|how)\b/i.test(p.message);
        if(!explicit)throw new StateError(422,'To publish the reviewed handoff, say “Publish the work ticket to GitHub.” Email and social-network publication need their own reviewed destination.');
        if(!state.artifacts.some(a=>a.name.startsWith('Launch kit')&&a.approvalRevision===state.approvalRevision))throw new StateError(422,'Prepare and review the launch kit first, then ask me to publish its work ticket.');
        let ticket;try{ticket=await progress.run('github','Publish the approved work ticket to the project board',()=>publishWorkTicket(DATA,kit));}catch{throw new StateError(503,'The public work ticket was not confirmed. Inspect the project board before retrying; the handoff is still saved.');}
        const prior=state.artifacts.find(a=>a.url===ticket.url);
        if(!prior)state.artifacts.push({id:randomUUID(),name:`Published work ticket · #${ticket.number}`,url:ticket.url,approvalRevision:state.approvalRevision!,approval:{...state.rehearsal.approved!}});
        state.events.push({id:'github-ticket',label:'Published the approved production handoff',detail:`${ticket.url}; ${ticket.reused?'existing ticket reused':'new public project ticket'}; approval revision ${state.approvalRevision}. Email and social copy remain drafts.`,at:new Date().toISOString()});
        reply=`The approved production handoff is now public as GitHub work ticket #${ticket.number}. Its link is below. The supplier email and social post remain drafts for your review.`;
      }
    }
    if(intent.action==='browse'){
      const browser=await readTenkiSupplier(DATA,{progress:(status,detail)=>progress!.record('supplier-browser','tenki','Read the public supplier catalog on Tenki Cloud',status,detail)})??await readSupplierPage({target:'printful-tshirts',timeoutMs:20000,screenshotDir:`${DATA}/browser-shots`,progress:(status,detail)=>progress!.record('supplier-browser','browser','Read the public supplier catalog',status,detail)});
      if(browser.outcome!=='read'||!browser.tab.closed)throw new StateError(503,'The supplier read or its tab cleanup was not confirmed. The approved plan is unchanged.');
      const safe={...browser,browser:{...browser.browser,cdpHost:browser.browser.cdpHost==='Tenki Cloud'?'Tenki Cloud':'local Chrome'},screenshot:browser.screenshot?{...browser.screenshot,path:`/api/conversation/browser-shot/${browser.id}`}:null};
      await mkdir(`${DATA}/receipts`,{recursive:true});await writeFile(`${DATA}/receipts/${browser.id}.json`,JSON.stringify(safe,null,2),{mode:0o600});
      state.artifacts.push({id:browser.id,name:'Supplier browser receipt · live page',url:`/api/conversation/receipt/${browser.id}`});
      state.events.push({id:'browser-read',label:'Read the live supplier catalog',detail:`${browser.page.title}; ${browser.page.excerptChars} visible characters; ${safe.browser.cdpHost}; dedicated browser/tab closed. This is a current website read, not a supplier quote or an order.`,at:new Date().toISOString()});
      reply=`I opened the supplier catalog and read “${browser.page.title??browser.target.label}”. The page shows ${browser.page.headings.slice(0,2).join(' and ')||'custom T-shirts'}. Its screenshot and receipt are saved below. This website check does not confirm stock or pricing for our sample plan.`;
    }
    if(!reply) {
      const answer=await progress.run('apple','Explain the result using the current facts',()=>localModel('reply',JSON.stringify({...context,capabilities:'Explore sample stock lots, reservations and quality holds; compare quantities, budgets and deadlines; remember shipment instructions; approve a plan; create an approved work packet; prepare supplier email and social drafts; publish an explicitly approved GitHub work ticket. No purchases or social-network publishing.',sampleData:business.sampleData,cloudModelCalls:0,activity:state.events.slice(-8)})));
      if(typeof answer.reply!=='string'||!answer.reply.trim())throw new StateError(503,'Please try that request again.');
      reply=answer.reply.trim().slice(0,1600);
    }
    if(applied.draft) {
      await mkdir(`${DATA}/drafts`,{recursive:true});const id=randomUUID();
      let content=applied.draft,name=`Customer reply · ${state.quantity} shirts`;
      if(state.rehearsal.approved){const packet=await progress.run('rote','Replay the approved-work-packet Play',()=>packetProcedure(state));content=packet.text;name=`Approved work packet · ${state.quantity} shirts`;state.events.push({id:'rote-packet',label:'Replayed the approved-work-packet Play',detail:`${packet.receipt.engine}; ${packet.receipt.runId}; ${packet.receipt.ms} ms. Draft customer reply and next work saved; nothing sent.`,at:new Date().toISOString()});}
      await writeFile(`${DATA}/drafts/${id}.md`,content,{mode:0o600});
      state.artifacts.push({id,name,url:`/api/conversation/artifact/${id}`,...(state.rehearsal.approved&&state.approvalRevision?{approvalRevision:state.approvalRevision,approval:{...state.rehearsal.approved}}:{})});
    }
    const at=new Date().toISOString();
    state.events.push({id:'local-language-model',label:'Understood with the on-device model',detail:`Apple FoundationModels interpreted “${intent.action}”; ${Date.now()-started} ms for this turn. No cloud model request.`,at});
    state.messages.push({role:'user',text:p.message.trim(),at},{role:'assistant',text:reply,at});
    state.messages=state.messages.slice(-60);state.events=state.events.slice(-80);state.revision++;
    await persist(state);
    failedReview=undefined;
    const updatedMemory=await workspace.merge(state);
    if(updatedMemory.revision!==memory.revision){
      try{const receipt=await progress.run('cognee','Save this company’s new memory revision',()=>saveCognee(updatedMemory));state.events.push({id:'cognee-save',label:'Saved the updated company memory in Cognee',detail:`Dataset ${receipt.datasetId}; revision ${receipt.revision}. Raw document stored; no external model call.`,at:new Date().toISOString()});}
      catch{state.events.push({id:'cognee-save-pending',label:'Company memory saved locally',detail:'Cognee did not confirm the write. Local memory is retained; no Cognee completion is claimed.',at:new Date().toISOString()});}
      await persist(state);
    }
    progress.record('turn-result','desk','Finish this request','complete','The response and its saved state are ready.');
    return {state,reply,engine:'Apple on-device model',cloudModelCalls:0,paidServiceCalls:0};
  } catch(error) {
    progress?.record('turn-result','desk','Finish this request','error','The request did not finish. Follow the conversation’s recovery instructions.');
    if(failedReview){
      failedReview.revision++;
      failedReview.events.push({id:'review-paused',label:'Cleared the prior approval after an incomplete review',detail:'The replacement proposal was not verified. Review the order again before approving or drafting it.',at:new Date().toISOString()});
      await persist(failedReview);
      const detail=error instanceof StateError?error.message:'The order review did not finish.';
      throw new StateError(error instanceof StateError?error.status:503,`${detail} The previous proposal and approval were cleared. Reload this conversation, then try the review again.`);
    }
    throw error;
  } finally {turnBusy=false;progress?.end();}
}
export async function sendApprovedDemoEmail(payload:unknown){
 if(!payload||typeof payload!=='object')throw new StateError(400,'Choose an approved handoff.');
 const p=payload as {id:unknown;revision:unknown};if(turnBusy)throw new StateError(429,'Finish the current request first.');turnBusy=true;
 try{let state=await getConversation(p.id);if(state.revision!==p.revision)throw new StateError(409,'The conversation changed; reload it.');const source=await companyData(`${DATA}/company/data.json`),memory=await workspace.read();state=refreshCompanyContext(state,source.sha256,memory.notes);if(!hasCurrentCloudReview(state,source.data))throw new StateError(422,'Review and approve the current plan first.');
 const kit=prepareLaunchKit(state,source.data),receipt=await sendProjectEmail(DATA,kit),id=randomUUID(),at=new Date().toISOString();await mkdir(`${DATA}/drafts`,{recursive:true});await writeFile(`${DATA}/drafts/${id}.md`,JSON.stringify(receipt,null,2),{mode:0o600});state.artifacts.push({id,name:'Sent demo email · hello@trusynth.com',url:`/api/conversation/artifact/${id}`});const reply=receipt.reused?'The previously sent demo email is available. I did not send it again.':'Sent the approved sample handoff to hello@trusynth.com. Gmail confirms it is in Sent. No supplier order was placed.';state.events.push({id:'project-email-sent',label:'Gmail confirmed the demo email',detail:reply,at});state.messages.push({role:'user',text:'Send the approved demo handoff to hello@trusynth.com.',at},{role:'assistant',text:reply,at});state.revision++;await persist(state);return {state,reply,receipt};
 }finally{turnBusy=false;}
}
export async function saveApprovedPrintfulDraft(payload:unknown){
 if(!payload||typeof payload!=='object')throw new StateError(400,'Choose an approved handoff.');
 const p=payload as {id:unknown;revision:unknown};if(turnBusy)throw new StateError(429,'Finish the current request first.');turnBusy=true;
 try{let state=await getConversation(p.id);if(state.revision!==p.revision)throw new StateError(409,'The conversation changed; reload it.');const source=await companyData(`${DATA}/company/data.json`),memory=await workspace.read();state=refreshCompanyContext(state,source.sha256,memory.notes);if(!hasCurrentCloudReview(state,source.data))throw new StateError(422,'Review and approve the current plan first.');
 const kit=prepareLaunchKit(state,source.data),receipt=await createPrintfulDraft(ROOT),id=randomUUID(),at=new Date().toISOString();await mkdir(`${DATA}/drafts`,{recursive:true});await writeFile(`${DATA}/drafts/${id}.md`,JSON.stringify(receipt,null,2),{mode:0o600});state.artifacts.push({id,name:'Printful sample order draft',url:`/api/conversation/artifact/${id}`});const reply=receipt.reused?'Your saved Printful sample draft is ready to review. It remains unsubmitted.':`Printful saved sample order ${receipt.id} as a draft with ${receipt.itemCount} item. It has not been submitted or paid. Product and artwork details are in the receipt.`;state.events.push({id:'printful-draft-saved',label:'Printful confirmed an unsubmitted draft',detail:reply,at});state.messages.push({role:'user',text:'Save a real unsubmitted Printful sample order draft.',at},{role:'assistant',text:reply,at});state.revision++;await persist(state);return {state,reply,receipt};
 }finally{turnBusy=false;}
}
export async function readDataReceipt(id:unknown){if(!validId(id))throw new StateError(404,'Receipt not found.');try{return await readFile(`${DATA}/receipts/${id}.json`,'utf8');}catch{throw new StateError(404,'Receipt not found.');}}
export async function readArtifact(id:unknown) {
  if(!validId(id))throw new StateError(404,'Draft not found.');
  try{return await readFile(`${DATA}/drafts/${id}.md`,'utf8');}catch{throw new StateError(404,'Draft not found.');}
}
export async function readBrowserShot(id:unknown){if(!validId(id))throw new StateError(404,'Browser preview not found.');try{return await readFile(`${DATA}/browser-shots/${id}.png`);}catch{throw new StateError(404,'Browser preview not found.');}}
export async function transcribeVoice(request:IncomingMessage) {
  if(audioBusy)throw new StateError(429,'I am finishing another voice note. Try again in a moment.');
  const type=request.headers['content-type']?.split(';')[0];
  const extensions:Record<string,string>={'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg'};
  if(!type||!extensions[type])throw new StateError(415,'Use a WebM, M4A, MP3, WAV or Ogg voice note.');
  audioBusy=true;let stage='receive'; const directory=`${DATA}/audio/${randomUUID()}`;
  try {
    const chunks:Buffer[]=[];let bytes=0;
    for await(const chunk of request){bytes+=chunk.length;if(bytes>4_000_000)throw new StateError(413,'Use a short voice note under 4 MB.');chunks.push(chunk);}
    if(bytes<100)throw new StateError(400,'The recording is empty. Please try again.');
    await mkdir(directory,{recursive:true});const source=`${directory}/voice.${extensions[type]}`,wav=`${directory}/decoded.wav`,out=`${directory}/transcript`;
    await writeFile(source,Buffer.concat(chunks),{mode:0o600});
    stage='decode';await run(process.env.TRU_FFMPEG??'ffmpeg',['-hide_banner','-nostdin','-v','error','-i',source,'-t','30','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-y',wav],{timeout:15000,maxBuffer:128000});
    stage='transcribe';await run(process.env.TRU_WHISPER_CLI??'whisper-cli',['-m',WHISPER,'-f',wav,'-l','en','-t','4','-mc','0','--vad','-vm',VAD,'-vp','250','-oj','-of',out],{timeout:45000,maxBuffer:128000});
    const raw=JSON.parse(await readFile(`${out}.json`,'utf8'));
    const text=(raw.transcription??[]).map((s:{text:string})=>s.text).join(' ').replace(/\s+/g,' ').trim();
    if(!text||text.length<2||/^\[.*\]$/.test(text))throw new StateError(422,"I didn't catch any clear speech. Please try again or type your message.");
    return {text:text.slice(0,2000),engine:'Local whisper.cpp 1.9.2 / large-v3-turbo-q5_0',cloudCalls:0};
  } catch(error) {if(error instanceof StateError)throw error;const e=error as NodeJS.ErrnoException & {stderr?:string;signal?:string};await writeFile(`${DATA}/last-voice-error.json`,JSON.stringify({at:new Date().toISOString(),stage,code:e.code,signal:e.signal,detail:e.message?.slice(0,250),stderr:e.stderr?.slice(-1200)}),{mode:0o600}).catch(()=>{});throw new StateError(503,'I could not transcribe that voice note locally. Try a shorter recording or type the message.');}
  finally {audioBusy=false;await rm(directory,{recursive:true,force:true});}
}

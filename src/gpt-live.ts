/** Server-owned GPT-Live allowance and delegation. No provider request occurs on import.
 * ROOT must protect all routes with existing authentication + exact Origin validation.
 * Official contracts: /guides/live-delegation, /guides/live-conversations, /guides/voice-webrtc?api=live.
 */
import {mkdir,open,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const GPT_LIVE_MODEL='gpt-live-1' as const;
export const GPT_LIVE_VOICE='willow' as const;
export interface GptLiveAllowance {schema:1;enabled:boolean;model:typeof GPT_LIVE_MODEL;gatewayBase:string;validUntil:string;creditVerifiedAt:string;availableCreditCents:number;autoRefillOff:true;maxCostCents?:number;maxSessions?:number;maxSessionSeconds?:number}
export interface LiveTranscript {role:'user'|'assistant';delta:string;startMs:number;endMs:number}
export interface LiveStart {attemptId:string;session:{id:string};transport:{type:'webrtc';sdp:string};expiresAt:string;maxSeconds:number;voice:typeof GPT_LIVE_VOICE}
export interface LiveDelegation {attemptId:string;delegationId:string;offsetMs:number;transcript:LiveTranscript[];discardedUserEndMs?:number}
export interface LiveReply {content:string;delegationId:string;reused?:boolean;stale?:boolean}
export interface LiveTurn {conversationId:string;message:string;delegationId:string;transcript:LiveTranscript[];signal:AbortSignal}
export interface GptLiveOptions {dataDir:string;conversationTurn:(input:LiveTurn)=>Promise<{reply:string}>;fetchImpl?:typeof fetch;token?:()=>string|undefined;now?:()=>number;timeoutMs?:number;schedule?:(fn:()=>void,ms:number)=>()=>void}
type Attempt={id:string;conversationId:string;createdAt:number;expiresAt:number;reservedCents:number;gatewayBase:string;sessionId?:string;status:'creating'|'active'|'ambiguous'|'closed';hangup?:'requested'|'accepted'|'unconfirmed';usage?:{seconds:number;final:boolean;source:'browser-session-event';reason?:string};delegations:Record<string,{offsetMs:number;status:'pending'|'done'|'unconfirmed';content?:string}>;lastOffset:number};
type Ledger={schema:1;attempts:Attempt[]};
export class GptLiveError extends Error {constructor(message:string,public status=409){super(message);this.name='GptLiveError';}}
const validId=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=180&&!['__proto__','constructor','prototype'].includes(s)&&/^[a-zA-Z0-9_-]+$/.test(s);
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
async function json(path:string):Promise<any>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new GptLiveError('Voice state needs inspection.');}}
// UTF-8 byte cap is conservative against the documented 500-token append ceiling.
export function liveSpokenText(s:string):string {let out='';for(const c of s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')){if(Buffer.byteLength(out+c)>480)break;out+=c;}return out.trim();}
export async function gptLiveAllowance(dataDir:string,now=Date.now()):Promise<GptLiveAllowance|null>{
 const a=await json(`${dataDir}/gpt-live-allowance.json`);if(!a||a.enabled===false)return null;
 if(a.schema!==1||a.enabled!==true||a.model!==GPT_LIVE_MODEL||a.autoRefillOff!==true||typeof a.gatewayBase!=='string'||!/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[a-f0-9]{32}\/[a-zA-Z0-9_-]+\/openai$/.test(a.gatewayBase)||!finite(a.availableCreditCents)||a.availableCreditCents<=0||a.availableCreditCents>1000||
  (a.maxSessions!==undefined&&(!Number.isInteger(a.maxSessions)||a.maxSessions<1))||
  (a.maxSessionSeconds!==undefined&&(!Number.isInteger(a.maxSessionSeconds)||a.maxSessionSeconds<1))||
  (a.maxCostCents!==undefined&&(!finite(a.maxCostCents)||a.maxCostCents<=0))||
  !Number.isFinite(Date.parse(a.validUntil))||Date.parse(a.validUntil)<now+15000||!Number.isFinite(Date.parse(a.creditVerifiedAt))||Date.parse(a.creditVerifiedAt)>now||now-Date.parse(a.creditVerifiedAt)>900000)throw new GptLiveError('Voice allowance or recent funded credit verification is invalid or expired.',503);
 return a;
}
export class GptLiveServer {
 private timers=new Map<string,()=>void>();private controllers=new Map<string,AbortController>();
 private now:()=>number;private fetcher:typeof fetch;
 constructor(private options:GptLiveOptions){this.now=options.now??Date.now;this.fetcher=options.fetchImpl??fetch;}
 private async locked<T>(fn:(ledger:Ledger)=>Promise<T>):Promise<T>{
  const dir=this.options.dataDir;await mkdir(dir,{recursive:true});const path=`${dir}/gpt-live-ledger.json`,lockPath=`${dir}/gpt-live.lock`;
  const lock=await open(lockPath,'wx',0o600).catch(()=>{throw new GptLiveError('Voice state is busy or requires reconciliation.');});
  try {const l:Ledger=await json(path)??{schema:1,attempts:[]};if(l.schema!==1||!Array.isArray(l.attempts)||l.attempts.length>10000||l.attempts.some(a=>!validId(a.id)||!finite(a.reservedCents)||!finite(a.expiresAt)||!a.delegations))throw new GptLiveError('Voice attempt ledger is invalid.');
   const value=await fn(l),pending=`${path}.${randomUUID()}.new`;await writeFile(pending,JSON.stringify(l,null,2),{mode:0o600});await rename(pending,path);return value;
  }finally{await lock.close();await unlink(lockPath);}
 }
 private token(){const t=(this.options.token??(()=>process.env.CF_AIG_TOKEN))();if(!t||/[\r\n]/.test(t))throw new GptLiveError('Server voice gateway authentication is unavailable.',503);return t;}
 private async post(url:string,body?:unknown):Promise<Response>{
  try{return await this.fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','cf-aig-authorization':`Bearer ${this.token()}`},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(Math.min(15000,this.options.timeoutMs??15000))});}
  catch{throw new GptLiveError('Voice provider result is unconfirmed; no automatic retry was made.',502);}
 }
 private arm(a:Attempt){const fn=()=>{this.timers.delete(a.id);void this.hangupKnown(a).catch(()=>{/* Receipt remains unconfirmed; never retry creation. */});};const ms=Math.max(0,a.expiresAt-this.now());const cancel=this.options.schedule?this.options.schedule(fn,ms):(()=>{const t=setTimeout(fn,ms);t.unref();return ()=>clearTimeout(t);})();this.timers.set(a.id,cancel);}
 /** Call once on server startup: existing unresolved sessions are closed, never recreated. */
 async recover(){const a=await this.locked(async l=>l.attempts.filter(a=>a.sessionId&&a.status!=='closed').map(a=>({...a})));for(const attempt of a)await this.close(attempt.id);}
 async create(input:{sdp:string;conversationId:string}):Promise<LiveStart>{
  if(typeof input.sdp!=='string'||!input.sdp.startsWith('v=0')||Buffer.byteLength(input.sdp)>64000||!validId(input.conversationId))throw new GptLiveError('A valid SDP offer and conversation are required.',400);
  const a=await gptLiveAllowance(this.options.dataDir,this.now());if(!a)throw new GptLiveError('Live voice is disabled.',503);this.token();
  const attempt=await this.locked(async l=>{
   if(l.attempts.some(x=>x.status!=='closed'||x.hangup!=='accepted'))throw new GptLiveError('A previous voice attempt is active or unconfirmed; inspect before creating another.');
   // A newer ROOT-verified balance snapshot already accounts for earlier closed sessions.
   // Browser-reported usage cannot release a financial reservation by itself.
   const spent=l.attempts.filter(x=>x.createdAt>=Date.parse(a.creditVerifiedAt)).reduce((n,x)=>n+x.reservedCents,0);
   const funds=Math.min(a.availableCreditCents,a.maxCostCents??a.availableCreditCents)-spent;
   const fundedSeconds=Math.floor(funds*60/5)-30; // two bounded15s hangup attempts within remaining credit
   const seconds=Math.min(a.maxSessionSeconds??fundedSeconds,fundedSeconds);
   const cost=Math.ceil((Math.max(15,seconds)+30)*5/60);
   if((a.maxSessions!==undefined&&l.attempts.length>=a.maxSessions)||seconds<15||cost>funds)throw new GptLiveError('The verified funded voice balance or configured allowance is exhausted.');
   const x:Attempt={id:randomUUID(),conversationId:input.conversationId,createdAt:this.now(),expiresAt:this.now()+seconds*1000,reservedCents:cost,gatewayBase:a.gatewayBase,status:'creating',delegations:{},lastOffset:-1};l.attempts.push(x);return {...x};
  });
  try{
   const r=await this.post(`${a.gatewayBase}/live/sessions`,{session:{model:GPT_LIVE_MODEL,store:false,audio:{output:{voice:GPT_LIVE_VOICE}},delegation:{type:'client'},instructions:'You are Synth, an AI voice assistant for the sample order desk. Speak warmly, calmly and briefly. Delegate every order, data, memory, review, approval, artifact or action request to the application backend. Only report actions confirmed by its results. Approval, sending, publishing and buying always remain governed by the application. Never invent quantities, prices, successful actions or permissions. Ask a short clarifying question when speech is ambiguous.'},transport:{type:'webrtc',sdp:input.sdp}});
   if(!r.ok)throw new GptLiveError('Voice session creation was not confirmed; attempt retained.',502);
   const raw=await r.text();if(raw.length>100000)throw new GptLiveError('Voice session response is invalid.',502);const b=JSON.parse(raw);
   // Save the known ID before validating SDP so a malformed answer can still be hung up.
   if(!validId(b?.session?.id))throw new GptLiveError('Voice session identity was not confirmed.',502);
   attempt.sessionId=b.session.id;attempt.status='active';await this.locked(async l=>Object.assign(l.attempts.find(x=>x.id===attempt.id)!,attempt));this.arm(attempt);
   if(b?.transport?.type!=='webrtc'||typeof b.transport.sdp!=='string'||!b.transport.sdp.startsWith('v=0')||this.now()>=attempt.expiresAt)throw new GptLiveError('Voice SDP answer or session deadline is invalid.',502);
   return {attemptId:attempt.id,session:{id:attempt.sessionId!},transport:{type:'webrtc',sdp:b.transport.sdp},expiresAt:new Date(attempt.expiresAt).toISOString(),maxSeconds:Math.floor((attempt.expiresAt-attempt.createdAt)/1000),voice:GPT_LIVE_VOICE};
  }catch{await this.locked(async l=>{l.attempts.find(x=>x.id===attempt.id)!.status='ambiguous';});if(attempt.sessionId)await this.close(attempt.id);throw new GptLiveError('Voice creation is unconfirmed. Its attempt remains reserved; no retry was made.',502);}
 }
 async delegate(input:LiveDelegation):Promise<LiveReply>{
  if(!validId(input.attemptId)||!validId(input.delegationId)||!finite(input.offsetMs)||!Array.isArray(input.transcript)||input.transcript.length>400||input.transcript.some(t=>!['user','assistant'].includes(t.role)||typeof t.delta!=='string'||t.delta.length>4000||!finite(t.startMs)||!finite(t.endMs)||t.endMs<t.startMs)||JSON.stringify(input.transcript).length>32000)throw new GptLiveError('Invalid voice delegation context.',400);
  const reservation=await this.locked(async l=>{const a=l.attempts.find(x=>x.id===input.attemptId);if(!a||a.status!=='active'||a.hangup||this.now()>=a.expiresAt)throw new GptLiveError('Voice session is no longer accepting work.');
   if(input.discardedUserEndMs!==undefined&&(!finite(input.discardedUserEndMs)||input.discardedUserEndMs>a.lastOffset))throw new GptLiveError('Voice context is incomplete; use the text desk to clarify before acting.',400);
   const old=a.delegations[input.delegationId];if(old){if(old.status==='done')return {a:{...a},reply:{content:old.content!,delegationId:input.delegationId,reused:true}};throw new GptLiveError('Delegation is already running or unconfirmed.');}
   if(Object.values(a.delegations).some(d=>d.status!=='done')||Object.keys(a.delegations).length>=10000)throw new GptLiveError('Voice backend is busy or delegation limit reached.');
   if(input.offsetMs<=a.lastOffset)throw new GptLiveError('Stale voice delegation.');
   const fragments=input.transcript.filter(t=>t.role==='user'&&t.startMs>=a.lastOffset&&t.endMs>a.lastOffset&&t.endMs<=input.offsetMs).sort((x,y)=>x.startMs-y.startMs),message=fragments.map(t=>t.delta).join('').trim();
   if(!message||message.length>2000)throw new GptLiveError('No usable new user transcript; ask for clarification.',400);
   a.delegations[input.delegationId]={offsetMs:input.offsetMs,status:'pending'};a.lastOffset=input.offsetMs;return {a:{...a},message};
  });
  if(reservation.reply)return reservation.reply;
  const ctrl=new AbortController();this.controllers.set(input.attemptId,ctrl);
  let workTimer:ReturnType<typeof setTimeout>|undefined;
  try{const stopped=new Promise<never>((_,reject)=>{ctrl.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true});workTimer=setTimeout(()=>ctrl.abort(),Math.max(1,Math.min(30000,reservation.a.expiresAt-this.now())));});
   const result=await Promise.race([stopped,this.options.conversationTurn({conversationId:reservation.a.conversationId,message:reservation.message!,delegationId:input.delegationId,transcript:input.transcript,signal:ctrl.signal})]);const content=liveSpokenText(result.reply);if(!content)throw new Error('empty');
   const stale=await this.locked(async l=>{const a=l.attempts.find(x=>x.id===input.attemptId)!;a.delegations[input.delegationId]={offsetMs:input.offsetMs,status:'done',content};return a.status!=='active'||!!a.hangup||this.now()>=a.expiresAt||ctrl.signal.aborted;});return {delegationId:input.delegationId,content:stale?'':content,stale};
  }catch{await this.locked(async l=>{l.attempts.find(x=>x.id===input.attemptId)!.delegations[input.delegationId].status='unconfirmed';});throw new GptLiveError('Backend work is unconfirmed; do not repeat the action automatically.',502);}
  finally{clearTimeout(workTimer);this.controllers.delete(input.attemptId);}
 }
 /** Browser-observed events are explicitly labelled; never claim independent provider verification. */
 async observe(input:{attemptId:string;event:unknown}){const e=input.event as any;if(!validId(input.attemptId)||!e||!['session.usage.updated','session.closed'].includes(e.type)||!finite(e.usage?.seconds)||e.usage.seconds>86400)throw new GptLiveError('Invalid voice usage event.',400);
  return this.locked(async l=>{const a=l.attempts.find(x=>x.id===input.attemptId);if(!a||!a.sessionId||(e.type==='session.closed'&&e.session?.id!==a.sessionId))throw new GptLiveError('Voice event does not match the current session.',400);
   if(a.usage?.final)return a.usage;if(a.usage&&e.usage.seconds<a.usage.seconds)throw new GptLiveError('Voice usage regressed.',400);
   a.usage={seconds:e.usage.seconds,final:e.type==='session.closed',source:'browser-session-event',reason:typeof e.reason==='string'?e.reason.slice(0,80):undefined};if(a.usage.final)a.status='closed';return a.usage;
  });
 }
 /** HTTP hangup is independently scheduled. An accepted HTTP response is not final usage proof. */
 async close(attemptId:string){
  // Atomic-renamed ledger can be read while a delegation owns its write lock.
  const ledger:Ledger|null=await json(`${this.options.dataDir}/gpt-live-ledger.json`);
  const a=ledger?.attempts.find(x=>x.id===attemptId);if(!a?.sessionId)throw new GptLiveError('Unknown voice session.',404);
  await this.hangupKnown(a);
 }
 private async hangupKnown(a:Attempt){
  if(a.hangup==='accepted')return;
  this.controllers.get(a.id)?.abort();this.timers.get(a.id)?.();this.timers.delete(a.id);
  // Safe closure of a known session must not depend on acquiring the busy local ledger.
  // Only this idempotent hangup may be retried. Session creation is never retried.
  let accepted=false;
  for(let n=0;n<2&&!accepted;n++){try{accepted=(await this.post(`${a.gatewayBase}/live/sessions/${encodeURIComponent(a.sessionId!)}/hangup`)).ok;}catch{/* Preserve uncertainty. */}}
  for(let n=0;n<80;n++){
   try{await this.locked(async l=>{const x=l.attempts.find(x=>x.id===a.id)!;x.hangup=accepted?'accepted':'unconfirmed';if(!accepted||!x.usage?.final)x.status='ambiguous';});return;}
   catch(e){if(n===79)throw e;await new Promise(r=>setTimeout(r,25));}
  }
 }
}

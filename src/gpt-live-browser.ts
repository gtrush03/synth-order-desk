/** Browser-only voice transport. Never imports server code, credentials or provider URLs. */
import type {LiveStart,LiveDelegation,LiveReply,LiveTranscript} from './gpt-live.ts';
export type LiveStatus='idle'|'connecting'|'listening'|'working'|'closing'|'closed'|'unconfirmed'|'error';
export interface GptLiveBrowserOptions {
 audio:HTMLAudioElement;
 createSession:(input:{sdp:string;conversationId:string})=>Promise<LiveStart>;
 delegate:(input:LiveDelegation)=>Promise<LiveReply>;
 observe:(input:{attemptId:string;event:unknown})=>Promise<unknown>;
 closeSession:(attemptId:string)=>Promise<unknown>;
 onStatus?:(status:LiveStatus,detail:string)=>void;
 onTranscript?:(fragment:LiveTranscript)=>void;
 onResult?:(reply:LiveReply)=>void;
 peerFactory?:()=>RTCPeerConnection;
 getUserMedia?:()=>Promise<MediaStream>;
 lifecycleTarget?:EventTarget;
 connectTimeoutMs?:number;
 closeTimeoutMs?:number;
}
/** Pure event coordinator, also exercised with injected transports. */
export class LiveEventBridge {
 readonly transcript:LiveTranscript[]=[];private seen=new Set<string>();private inputVersion=0;private generation=0;private stopped=false;private started=false;private eventIds=new Set<string>();private pendingDelegations:unknown[]=[];private discardedUserEndMs=0;private observation=Promise.resolve();
 constructor(private session:LiveStart,private opts:Pick<GptLiveBrowserOptions,'delegate'|'observe'|'onStatus'|'onTranscript'|'onResult'>,private send:(event:unknown)=>void,private finalized:(confirmed:boolean)=>void){}
 stop(){this.stopped=true;this.generation++;}
 async event(value:unknown){const e=value as any;if(!e||typeof e.type!=='string')return;
  if(typeof e.event_id==='string'){if(this.eventIds.has(e.event_id))return;this.eventIds.add(e.event_id);if(this.eventIds.size>5000)this.eventIds.delete(this.eventIds.values().next().value!);}
  if(e.type==='session.closed'){
   if(e.session?.id!==this.session.session.id||typeof e.usage?.seconds!=='number'||!Number.isFinite(e.usage.seconds)||e.usage.seconds<0){this.opts.onStatus?.('unconfirmed','Final voice event did not match this session.');return;}
   this.stop();await this.record(e);this.finalized(true);return;
  }
  if(e.type==='session.usage.updated'){await this.record(e);return;}
  if(this.stopped)return;
  if(e.type==='session.started'){if(e.session?.id===this.session.session.id){this.started=true;this.opts.onStatus?.('listening','GPT-Live-1 · Willow connected');const pending=this.pendingDelegations.splice(0);for(const event of pending)await this.event(event);}return;}
  if(e.type==='session.input_transcript.delta'||e.type==='session.output_transcript.delta'){
   if(typeof e.delta!=='string'||e.delta.length>4000||typeof e.start_ms!=='number'||typeof e.end_ms!=='number'||!Number.isFinite(e.start_ms)||!Number.isFinite(e.end_ms)||e.start_ms<0||e.end_ms<e.start_ms)return;
   if(this.transcript.length>=400){const old=this.transcript.shift()!;if(old.role==='user')this.discardedUserEndMs=Math.max(this.discardedUserEndMs,old.endMs);}
   const t:LiveTranscript={role:e.type==='session.input_transcript.delta'?'user':'assistant',delta:e.delta,startMs:e.start_ms,endMs:e.end_ms};this.transcript.push(t);if(t.role==='user')this.inputVersion++;this.opts.onTranscript?.(t);return;
  }
  if(e.type==='error'){this.opts.onStatus?.('error','Voice provider reported an error. No action was retried.');return;}
  if(e.type!=='session.delegation.created'||e.delegation?.target!=='client'||typeof e.delegation.id!=='string'||typeof e.offset_ms!=='number'||!Number.isFinite(e.offset_ms)||e.offset_ms<0)return;
  if(!this.started){if(this.pendingDelegations.length<20){const pending={...e};delete pending.event_id;this.pendingDelegations.push(pending);}return;}
  const id=e.delegation.id;if(this.seen.has(id))return;this.seen.add(id);
  const version=this.inputVersion,generation=this.generation;this.opts.onStatus?.('working','The order desk is checking your request.');
  try{const result=await this.opts.delegate({attemptId:this.session.attemptId,delegationId:id,offsetMs:e.offset_ms,discardedUserEndMs:this.discardedUserEndMs||undefined,transcript:this.transcript.map(t=>({...t}))});
   // A late result must not speak over a correction or reconnect. Backend owns any action already begun.
   if(this.stopped||generation!==this.generation||version!==this.inputVersion||result.stale||result.delegationId!==id)return;
   if(result.content){this.send({type:'session.commentary.append',event_id:crypto.randomUUID(),delegation_id:id,content:result.content});this.opts.onResult?.(result);}
   this.opts.onStatus?.('listening','Backend result received; voice playback is separate.');
  }catch{if(!this.stopped&&generation===this.generation&&version===this.inputVersion){this.send({type:'session.commentary.append',event_id:crypto.randomUUID(),delegation_id:id,content:'The application could not confirm that request. Please check the order desk before repeating any action.'});this.opts.onStatus?.('error','Backend action unconfirmed. No automatic retry.');}}
 }
 private async record(e:unknown){this.observation=this.observation.then(async()=>{await this.opts.observe({attemptId:this.session.attemptId,event:e});}).catch(()=>{this.opts.onStatus?.('unconfirmed','Voice event received, but saving its usage receipt failed.');});await this.observation;}
}
/** Gather the complete offer before any billable creation; abort/timeout removes listeners. */
export function waitForLiveIce(peer:RTCPeerConnection,signal:AbortSignal,timeoutMs=10000):Promise<void>{
 return new Promise((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const cleanup=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);signal.removeEventListener('abort',aborted);};
  const changed=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};
  const aborted=()=>{cleanup();reject(new Error('Voice setup stopped.'));};
  timer=setTimeout(()=>{cleanup();reject(new Error('ICE gathering timed out.'));},timeoutMs);
  peer.addEventListener('icegatheringstatechange',changed);signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted)aborted();else changed();
 });
}
export class GptLiveBrowser {
 private peer?:RTCPeerConnection;private channel?:RTCDataChannel;private mic?:MediaStream;private session?:LiveStart;private bridge?:LiveEventBridge;private generation=0;private active=false;private closing=false;private ended=false;private closeTimer?:ReturnType<typeof setTimeout>;private limitTimer?:ReturnType<typeof setTimeout>;private connectTimer?:ReturnType<typeof setTimeout>;private connectAbort?:AbortController;private lifecycle?:EventTarget;private readonly pagehide=()=>{void this.stop();};
 constructor(private opts:GptLiveBrowserOptions){}
 async start(conversationId:string){if(this.active)throw new Error('Voice session already active.');this.active=true;this.closing=false;this.ended=false;const generation=++this.generation;this.status('connecting','Requesting microphone and voice connection…');this.connectAbort=new AbortController();this.lifecycle=this.opts.lifecycleTarget??(typeof window!=='undefined'?window:undefined);this.lifecycle?.addEventListener('pagehide',this.pagehide);this.connectTimer=setTimeout(()=>{void this.stop();this.status('unconfirmed','Voice setup timed out; no automatic retry.');},this.opts.connectTimeoutMs??30000);
  try{
   const peer=(this.opts.peerFactory??(()=>new RTCPeerConnection()))();this.peer=peer;
   peer.addEventListener('track',e=>{if(generation!==this.generation)return;this.opts.audio.srcObject=new MediaStream([e.track]);void this.opts.audio.play().catch(()=>this.status('listening','Select the audio play control to hear Synth.'));});
   peer.addEventListener('connectionstatechange',()=>{if(generation===this.generation&&['failed','disconnected'].includes(peer.connectionState))void this.stop();});
   const mic=await (this.opts.getUserMedia??(()=>navigator.mediaDevices.getUserMedia({audio:true})))();if(generation!==this.generation||this.closing){mic.getTracks().forEach(t=>t.stop());return;}this.mic=mic;mic.getAudioTracks().forEach(t=>peer.addTrack(t,mic));
   const dc=peer.createDataChannel('oai-events');this.channel=dc;const queued:unknown[]=[];
   dc.addEventListener('message',e=>{if(generation!==this.generation)return;let value:unknown;try{if(typeof e.data!=='string'||e.data.length>64000)return;value=JSON.parse(e.data);}catch{return;}if(this.bridge)void this.bridge.event(value);else if(queued.length<100)queued.push(value);});
   dc.addEventListener('close',()=>{if(generation===this.generation&&!this.ended){this.status('unconfirmed','Connection closed before final session usage.');void this.stop();}});
   const offer=await peer.createOffer();await peer.setLocalDescription(offer);await waitForLiveIce(peer,this.connectAbort.signal);if(generation!==this.generation||this.closing)return;
   const sdp=peer.localDescription?.sdp;if(!sdp)throw new Error('Missing gathered SDP.');
   const session=await this.opts.createSession({sdp,conversationId});
   if(generation!==this.generation||this.closing){await this.opts.closeSession(session.attemptId);return;}
   this.session=session;this.bridge=new LiveEventBridge(session,{...this.opts,onStatus:(status,detail)=>{if(status==='listening')clearTimeout(this.connectTimer);this.status(status,detail);}},event=>{if(dc.readyState==='open')dc.send(JSON.stringify(event));},confirmed=>{this.ended=confirmed;if(!confirmed)void this.opts.closeSession(session.attemptId).catch(()=>{});this.cleanup();this.status(confirmed?'closed':'unconfirmed',confirmed?'Voice closed; final usage event received.':'Voice stopped; final usage unconfirmed.');});
   for(const event of queued)await this.bridge.event(event);
   if(this.ended)return;
   this.limitTimer=setTimeout(()=>void this.stop(),Math.max(0,Date.parse(session.expiresAt)-Date.now()));
   await peer.setRemoteDescription({type:'answer',sdp:session.transport.sdp});
  }catch{if(generation!==this.generation)return;if(this.session)void this.opts.closeSession(this.session.attemptId).catch(()=>{});this.cleanup();this.status('error','Voice connection was not confirmed. No automatic retry was made.');}
 }
 async stop(){if(!this.active||this.closing)return;this.closing=true;this.bridge?.stop();this.status('closing','Ending voice and waiting for final usage…');this.mic?.getTracks().forEach(t=>{t.enabled=false;});
  if(!this.session){this.cleanup();this.status('closed','Microphone released.');return;}
  // Keep listeners, peer and mic alive until session.closed; closing the transport is not a receipt.
  this.closeTimer=setTimeout(()=>{this.cleanup();this.status('unconfirmed','Voice stopped; final usage event was not received.');},this.opts.closeTimeoutMs??15000);
  if(this.channel?.readyState==='open')this.channel.send(JSON.stringify({type:'session.close'}));
  try{await this.opts.closeSession(this.session.attemptId);}catch{this.status('unconfirmed','Server hangup not confirmed; the server deadline remains active.');}
 }
 private status(s:LiveStatus,detail:string){this.opts.onStatus?.(s,detail);}
 private cleanup(){this.active=false;this.generation++;clearTimeout(this.closeTimer);clearTimeout(this.limitTimer);clearTimeout(this.connectTimer);this.connectAbort?.abort();this.lifecycle?.removeEventListener('pagehide',this.pagehide);this.bridge?.stop();this.mic?.getTracks().forEach(t=>t.stop());this.channel?.close();this.peer?.close();this.opts.audio.srcObject=null;this.mic=undefined;this.peer=undefined;this.channel=undefined;this.bridge=undefined;this.session=undefined;}
}
/** Optional same-origin route callbacks. ROOT mounts these routes behind its existing auth/Origin guard. */
export function liveHttpCallbacks(base='/api/gpt-live'){
 if(!/^\/[a-zA-Z0-9/_-]+$/.test(base)||base.startsWith('//'))throw new Error('Voice routes must use a same-origin path.');
 async function post<T>(path:string,body:unknown):Promise<T>{const r=await fetch(base+path,{method:'POST',keepalive:path==='/close',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('Voice request was not confirmed.');return r.json() as Promise<T>;}
 return {createSession:(input:{sdp:string;conversationId:string})=>post<LiveStart>('/session',input),delegate:(input:LiveDelegation)=>post<LiveReply>('/delegate',input),observe:(input:{attemptId:string;event:unknown})=>post('/event',input),closeSession:(attemptId:string)=>post('/close',{attemptId})};
}

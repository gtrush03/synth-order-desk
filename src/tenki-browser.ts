import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {SUPPLIER_PAGES,type BrowserActionReceipt} from './browser-actions.ts';
import {prepareLaunchKit,type LaunchKit} from './work-ticket.ts';
import {hasCurrentCloudReview,reviewFingerprint} from './approval-proof.ts';
import type {ConversationState} from './conversation-model.ts';
import type {CompanyData} from './company-workspace.ts';

class TenkiError extends Error {}
export const TENKI_FIXED={sdkModule:`${process.cwd()}/node_modules/@tenkicloud/sandbox/dist/index.mjs`,sessionId:'01a0923e-0861-78cc-ae28-14620e2d55a9',workspaceId:'01a083d2-e67b-71c2-8396-69355e11e6b8',runId:'0176be3d-3b5b-4af9-8367-3bcb39b4a6d7',cpuCores:2,memoryMb:4096,diskSizeGb:5,sessionExpiresAt:'2026-09-11T23:51:25.313Z',previewUrl:'https://synth-order-work--23h39h.us.sb.tenki.sh',validUntil:'2026-09-11T23:49:25.313Z'} as const;
export const TENKI_GUEST={script:'/home/tenki/synth-browser/read.mjs',scriptSha:'5208d5eadd284e8423e8f810f9fdf03ef66dcdae64d700f3e721e60e8d389723',status:'/home/tenki/synth-preview/public/status.json',kit:'/home/tenki/synth-preview/public/approved-work.md'} as const;
export interface TenkiAllowance {schema:1;enabled:true;sdkModule:string;sessionId:string;workspaceId:string;runId:string;cpuCores:number;memoryMb:number;diskSizeGb:number;sessionExpiresAt:string;previewUrl:string;validUntil:string;maxReads:number;maxUploads:number;sampleOnly:true}
export interface TenkiSession {id:string;workspaceId:string;metadata:Record<string,string>;state:string;cpuCores:number;memoryMb:number;diskSizeGb:number;timeoutAt:Date;exec(command:string,options:Record<string,unknown>):Promise<{exitCode:number;[key:string]:unknown}>;readFile(path:string):Promise<Uint8Array>;writeFile(path:string,data:string):Promise<unknown>}
export interface TenkiConnection {get(id:string):Promise<TenkiSession>;close():void;stdoutText(result:unknown):string}
export interface TenkiOptions {connect?:(allowance:TenkiAllowance)=>Promise<TenkiConnection>;now?:()=>number;timeoutMs?:number;progress?:(status:'running'|'complete'|'error',detail:string)=>void}
export interface TenkiUploadReceipt {provider:'Tenki Cloud';fingerprint:string;quantity:number;approvalRevision:number;markdownSha256:string;url:string;expiresAt:string;uploadedAt:string;reused:boolean}
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
async function json(path:string){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new TenkiError('Tenki private state is invalid; inspect it before retrying.');}}
export async function tenkiAllowance(root:string,now=Date.now()):Promise<TenkiAllowance|null>{
 const a=await json(`${root}/tenki-browser-allowance.json`);if(a===null||a.enabled===false)return null;
 if(a.schema!==1||a.enabled!==true||a.sampleOnly!==true||Object.entries(TENKI_FIXED).some(([k,v])=>a[k]!==v)||![a.maxReads,a.maxUploads].every(n=>Number.isInteger(n)&&n>=1&&n<=6)||Date.parse(a.validUntil)<=now+45000||Date.parse(a.sessionExpiresAt)<=now+45000)throw new TenkiError('Tenki allowance is invalid or expired; cloud work is paused.');
 return a;
}
async function connect(a:TenkiAllowance):Promise<TenkiConnection>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',pathToFileURL(a.sdkModule)),'utf8'));if(pkg.version!=='1.0.6'||pkg.name!=='@tenkicloud/sandbox')throw new TenkiError('Pinned Tenki SDK is unavailable.');
 const sdk=await import(/* @vite-ignore */ pathToFileURL(a.sdkModule).href);
 const key=(await readFile(`${homedir()}/.config/synthos/tenki-hackathon.env`,'utf8')).match(/^TENKI_API_KEY=(.+)$/m)?.[1]?.trim();if(!key)throw new TenkiError('Tenki host authentication is unavailable.');
 const client=new sdk.TenkiSandbox({authToken:key,timeoutMs:45000});return {get:id=>client.get(id),close:()=>client.close(),stdoutText:sdk.stdoutText};
}
function verifySession(s:TenkiSession,a:TenkiAllowance){if(s.id!==a.sessionId||s.workspaceId!==a.workspaceId||s.metadata?.runId!==a.runId||s.state!=='RUNNING'||s.cpuCores!==2||s.memoryMb!==4096||s.diskSizeGb!==5||new Date(s.timeoutAt).toISOString()!==a.sessionExpiresAt)throw new TenkiError('The existing Tenki computer no longer matches its authorized identity/resources.');}
interface Ledger {reads:number;uploads:number;uploadsByFingerprint:Record<string,{status:'pending'|'complete';receipt?:TenkiUploadReceipt}>}
async function atomic(path:string,value:unknown){const pending=`${path}.${randomUUID()}.new`;await writeFile(pending,JSON.stringify(value,null,2),{mode:0o600});await rename(pending,path);}
async function operate<T>(root:string,kind:'reads'|'uploads',fingerprint:string|undefined,options:TenkiOptions,work:(s:TenkiSession,a:TenkiAllowance,step:<R>(fn:()=>Promise<R>)=>Promise<R>,stdout:(r:unknown)=>string)=>Promise<T>):Promise<T|null>{
 const now=options.now??Date.now;const a=await tenkiAllowance(root,now());if(!a)return null;
 await mkdir(root,{recursive:true});const lockPath=`${root}/tenki-browser.lock`;const lock=await open(lockPath,'wx',0o600).catch(()=>{throw new TenkiError('Another Tenki action is active or unconfirmed; inspect before retrying.');});
 let client:TenkiConnection|undefined,timer:ReturnType<typeof setTimeout>|undefined;let expired=false;
 const ledgerPath=`${root}/tenki-browser-count.json`;
 try{
  const ledger:Ledger=await json(ledgerPath)??{reads:0,uploads:0,uploadsByFingerprint:{}};
  if(![ledger.reads,ledger.uploads].every(n=>Number.isInteger(n)&&n>=0&&n<=6)||!ledger.uploadsByFingerprint||typeof ledger.uploadsByFingerprint!=='object')throw new TenkiError('Tenki attempt ledger needs inspection.');
  if(fingerprint&&ledger.uploadsByFingerprint[fingerprint]){const prior=ledger.uploadsByFingerprint[fingerprint];if(prior.status==='complete'&&prior.receipt?.fingerprint===fingerprint&&prior.receipt.url===a.previewUrl)return {...prior.receipt,reused:true} as T;throw new TenkiError('The prior Tenki upload is unconfirmed; verify it before retrying.');}
  if(ledger[kind]>=(kind==='reads'?a.maxReads:a.maxUploads))throw new TenkiError('The bounded Tenki allowance is exhausted.');
  ledger[kind]++;if(fingerprint)ledger.uploadsByFingerprint[fingerprint]={status:'pending'};await atomic(ledgerPath,ledger);
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new TenkiError('Tenki operation timed out; no retry was made.'));},Math.min(45000,Math.max(1,options.timeoutMs??45000)));});deadline.catch(()=>{});
  const step=async<R>(fn:()=>Promise<R>)=>{if(expired||now()+1000>=Date.parse(a.validUntil))throw new TenkiError('Tenki operation expired.');return Promise.race([fn(),deadline]);};
  client=await step(()=>(options.connect??connect)(a));const session=await step(()=>client!.get(a.sessionId));verifySession(session,a);
  options.progress?.('running',kind==='reads'?'Reading the fixed supplier catalog on the existing Tenki computer':'Uploading the exact approved launch kit to the existing Tenki computer');
  const value=await work(session,a,step,r=>client!.stdoutText(r));
  if(fingerprint){ledger.uploadsByFingerprint[fingerprint]={status:'complete',receipt:value as TenkiUploadReceipt};await atomic(ledgerPath,ledger);}
  options.progress?.('complete',kind==='reads'?'Tenki supplier read and browser closure confirmed':'Approved launch kit uploaded to the temporary public preview');return value;
 }catch(e){options.progress?.('error','Tenki action not confirmed; no local fallback or automatic retry.');throw new TenkiError(e instanceof TenkiError?e.message:'Tenki action not confirmed; inspect its receipt before retrying.');}
 finally{if(timer)clearTimeout(timer);try{client?.close();}catch{/* Host client cleanup must not expose SDK/auth diagnostics. */}finally{await lock.close();await unlink(lockPath);}}
}
async function status(s:TenkiSession,step:<R>(fn:()=>Promise<R>)=>Promise<R>){const raw=await step(()=>s.readFile(TENKI_GUEST.status));if(raw.length>32000)throw new TenkiError('Tenki preview status exceeds its bound.');const old=JSON.parse(Buffer.from(raw).toString('utf8'));return {captureAt:typeof old.captureAt==='string'?old.captureAt:undefined,lastCaptureAt:typeof old.lastCaptureAt==='string'?old.lastCaptureAt:undefined,quantity:Number.isInteger(old.quantity)?old.quantity:undefined,approvalFingerprint:typeof old.approvalFingerprint==='string'?old.approvalFingerprint:undefined};}
export async function readTenkiSupplier(root:string,options:TenkiOptions={}):Promise<BrowserActionReceipt|null>{
 const startedAt=new Date((options.now??Date.now)()).toISOString();return operate(root,'reads',undefined,options,async(s,a,step,stdout)=>{
  const code=await step(()=>s.readFile(TENKI_GUEST.script));if(hash(code)!==TENKI_GUEST.scriptSha)throw new TenkiError('Tenki guest browser script changed; read paused.');
  const result=await step(()=>s.exec('node',{args:[TENKI_GUEST.script],cwd:'/home/tenki/synth-browser',env:{PLAYWRIGHT_BROWSERS_PATH:'/home/tenki/.cache/ms-playwright',TRU_TENKI_CHROMIUM:'/home/tenki/.cache/ms-playwright/chromium-1187/chrome-linux/chrome'},timeoutMs:35000}));
  const text=stdout(result);if(result.exitCode!==0||text.length>3000000)throw new TenkiError('Tenki browser result is invalid.');const r=JSON.parse(text);
  if(r.outcome!=='read'||r.closed!==true||r.url!==SUPPLIER_PAGES['printful-tshirts'].url||r.httpStatus!==200||typeof r.browserVersion!=='string'||typeof r.title!=='string'||typeof r.textExcerpt!=='string'||!Array.isArray(r.headings)||typeof r.screenshotBase64!=='string'||!Number.isFinite(r.ms)||!Number.isFinite(Date.parse(r.finishedAt)))throw new TenkiError('Tenki browser read or closure was not verified.');
  const bytes=Buffer.from(r.screenshotBase64,'base64');if(bytes.length<8||bytes.length>2000000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new TenkiError('Tenki screenshot is invalid.');
  const id=randomUUID(),path=`${root}/browser-shots/${id}.png`;await mkdir(`${root}/browser-shots`,{recursive:true});await writeFile(path,bytes,{mode:0o600});
  const old=await status(s,step);await step(()=>s.writeFile(TENKI_GUEST.status,JSON.stringify({...old,captureAt:r.finishedAt,lastCaptureAt:r.finishedAt,lastAction:'Live supplier catalog read on Tenki Cloud',expiresAt:a.validUntil})));
  const receipt:BrowserActionReceipt & {cloud:{sessionId:string;workspaceId:string;runId:string;scriptSha256:string;ownedBrowserClosed:true;sharedBrowserClosed:false;legacyGuardScope:string}}={cloud:{sessionId:a.sessionId,workspaceId:a.workspaceId,runId:a.runId,scriptSha256:TENKI_GUEST.scriptSha,ownedBrowserClosed:true,sharedBrowserClosed:false,legacyGuardScope:'guards.browserClosed refers only to the shared host browser; the dedicated guest browser was closed'},id,action:'supplier-page-read',target:SUPPLIER_PAGES['printful-tshirts'],startedAt,finishedAt:r.finishedAt,ms:r.ms,browser:{cdpHost:'Tenki Cloud',version:r.browserVersion.slice(0,80),protocol:null},tab:{createdByThisAction:true,targetIdPrefix:a.sessionId.slice(0,8),closed:true},page:{finalUrl:r.url,sameSite:true,httpStatus:200,title:r.title.slice(0,200),headings:r.headings.filter((h:unknown)=>typeof h==='string').slice(0,8).map((h:string)=>h.slice(0,120)),textExcerpt:r.textExcerpt.slice(0,1500),excerptChars:r.textExcerpt.slice(0,1500).length,loadMs:null,mainFrameNavigations:[r.url]},screenshot:{path,bytes:bytes.length,sha256:hash(bytes)},outcome:'read',guards:{cookiesRead:false,storageRead:false,otherTabsInspected:false,formsSubmitted:false,clicks:0,javascriptFromUser:false,browserClosed:false,navigationsBeyondTarget:0}};
  await mkdir(`${root}/receipts`,{recursive:true});await atomic(`${root}/receipts/${id}.json`,receipt);return receipt;
 });
}
export async function uploadTenkiLaunchKit(root:string,state:ConversationState,company:CompanyData,kit:LaunchKit,options:TenkiOptions={}):Promise<TenkiUploadReceipt|null>{
 const stamp=reviewFingerprint(state,company);
 const verify=()=>{const a=state.rehearsal.approved,p=state.rehearsal.proposal;const current=prepareLaunchKit(state,company);if(!a||!p||a.quantity!==state.quantity||p.quantity!==state.quantity||p.budgetCents!==state.budgetCents||p.chosen?.name!==a.option||p.chosen.totalCents!==a.totalCents||current.fingerprint!==kit.fingerprint||current.markdown!==kit.markdown||current.quantity!==kit.quantity||current.approvalRevision!==kit.approvalRevision||reviewFingerprint(state,company)!==stamp||(state.cloudReview&&!hasCurrentCloudReview(state,company))||Buffer.byteLength(kit.markdown)>24000)throw new TenkiError('Tenki upload requires the exact current approved sample packet.');};verify();
 return operate(root,'uploads',kit.fingerprint,options,async(s,a,step)=>{const old=await status(s,step);verify();await step(()=>s.writeFile(TENKI_GUEST.kit,kit.markdown));const readback=await step(()=>s.readFile(TENKI_GUEST.kit));if(hash(readback)!==hash(kit.markdown))throw new TenkiError('Tenki uploaded Markdown readback did not match.');verify();const uploadedAt=new Date((options.now??Date.now)()).toISOString();await step(()=>s.writeFile(TENKI_GUEST.status,JSON.stringify({...old,quantity:kit.quantity,approvalFingerprint:kit.fingerprint,approvalRevision:kit.approvalRevision,lastAction:'Approved launch kit ready · email and social drafts unsent',uploadedAt,expiresAt:a.validUntil})));return {provider:'Tenki Cloud',fingerprint:kit.fingerprint,quantity:kit.quantity,approvalRevision:kit.approvalRevision,markdownSha256:hash(kit.markdown),url:a.previewUrl,expiresAt:a.validUntil,uploadedAt,reused:false};});
}

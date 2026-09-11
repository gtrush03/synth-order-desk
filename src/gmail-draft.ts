import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import type {LaunchKit} from './work-ticket.ts';
const execute=promisify(execFile);
const ACCOUNT='hello@trusynth.com';
export interface GmailDraftReceipt {id:string;draftId:string;messageId:string;account:string;fingerprint:string;createdAt:string;sent:false;recipient:null;reused:boolean}
type Run=(args:string[])=>Promise<string>;
const actual:Run=async args=>(await execute(process.env.TRU_GWS??'gws',args,{timeout:25000,maxBuffer:256000})).stdout;
export async function gmailDraftEnabled(root:string){try{return JSON.parse(await readFile(`${root}/gmail-draft-allowance.json`,'utf8')).enabled===true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}

/** A real Gmail draft with no recipient. This module contains no send operation. */
export async function createGmailDraft(root:string,kit:LaunchKit,run:Run=actual):Promise<GmailDraftReceipt|null>{
  let allowance:{enabled:boolean;account:string;maxDrafts:number;validUntil:string};
  try{allowance=JSON.parse(await readFile(`${root}/gmail-draft-allowance.json`,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  if(!allowance.enabled)return null;
  if(allowance.account!==ACCOUNT||!Number.isInteger(allowance.maxDrafts)||allowance.maxDrafts<1||allowance.maxDrafts>6||!(Date.parse(allowance.validUntil)>Date.now()))throw Error('Gmail draft allowance is unavailable.');
  if(!/^[a-f0-9]{64}$/.test(kit.fingerprint))throw Error('Invalid approved handoff.');
  const dir=`${root}/gmail-drafts`,target=`${dir}/${kit.fingerprint}.json`,pending=`${target}.pending`;
  await mkdir(dir,{recursive:true});
  try{const saved=JSON.parse(await readFile(target,'utf8')) as GmailDraftReceipt;if(saved.fingerprint!==kit.fingerprint||saved.account!==ACCOUNT||saved.sent!==false)throw Error('Invalid Gmail receipt');return {...saved,reused:true};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  try{await readFile(pending);throw Error('The previous Gmail draft needs verification before retrying.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const profile=JSON.parse(await run(['gmail','users','getProfile','--params',JSON.stringify({userId:'me'})]));
  if(profile.emailAddress!==ACCOUNT)throw Error('The Gmail account is not the approved Synth sender.');
  let used=0;try{used=JSON.parse(await readFile(`${root}/gmail-draft-count.json`,'utf8')).used;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(!Number.isInteger(used)||used<0||used>=allowance.maxDrafts)throw Error('The bounded Gmail draft allowance is exhausted.');
  const subject=kit.email.subject.replace(/[\r\n]/g,' ').slice(0,160);
  const raw=Buffer.from(`From: Synth <${ACCOUNT}>\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMessage-ID: <synth-${kit.fingerprint}@trusynth.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(kit.email.body).toString('base64')}\r\n`).toString('base64url');
  await writeFile(pending,JSON.stringify({fingerprint:kit.fingerprint,startedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  await writeFile(`${root}/gmail-draft-count.json`,JSON.stringify({used:used+1,updatedAt:new Date().toISOString()}),{mode:0o600});
  const created=JSON.parse(await run(['gmail','users','drafts','create','--params',JSON.stringify({userId:'me'}),'--json',JSON.stringify({message:{raw}})]));
  if(typeof created.id!=='string'||typeof created.message?.id!=='string'||!created.message.labelIds?.includes('DRAFT'))throw Error('Gmail did not confirm an unsent draft.');
  const receipt:GmailDraftReceipt={id:kit.fingerprint.slice(0,12),draftId:created.id,messageId:created.message.id,account:ACCOUNT,fingerprint:kit.fingerprint,createdAt:new Date().toISOString(),sent:false,recipient:null,reused:false};
  await writeFile(target,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});return receipt;
}

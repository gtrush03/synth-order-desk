import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import type {LaunchKit} from './work-ticket.ts';
const execute=promisify(execFile),ACCOUNT='hello@trusynth.com';
type Run=(args:string[])=>Promise<string>;
const actual:Run=async args=>(await execute(process.env.TRU_GWS??'gws',args,{timeout:25000,maxBuffer:256000})).stdout;
export interface ProjectEmailReceipt {sent:true;recipient:string;messageId:string;fingerprint:string;createdAt:string;reused:boolean;deliveryConfirmed:false}
/** One send per approved handoff, up to six owner demo attempts; never a supplier send. */
export async function sendProjectEmail(root:string,kit:LaunchKit,run:Run=actual):Promise<ProjectEmailReceipt>{
 if(!/^[a-f0-9]{64}$/.test(kit.fingerprint))throw Error('Invalid approved handoff.');
 const parent=`${root}/project-email`,dir=`${parent}/${kit.fingerprint}`;await mkdir(dir,{recursive:true});const file=`${dir}/receipt.json`;
 try{const old=JSON.parse(await readFile(file,'utf8')) as ProjectEmailReceipt;if(old.sent!==true||old.recipient!==ACCOUNT||old.fingerprint!==kit.fingerprint)throw Error('The saved email does not match this approved handoff.');return {...old,reused:true};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const profile=JSON.parse(await run(['gmail','users','getProfile','--params',JSON.stringify({userId:'me'})]));if(profile.emailAddress!==ACCOUNT)throw Error('The signed-in sender is not the approved Synth account.');
 const subject='Synth demo — your approved sample order handoff';
 const text='This is the authorized Synth hackathon demo sent to our own account. Inventory and plan prices are sample data. No supplier order has been purchased or submitted.\n\n'+kit.email.body+'\n\nProject: https://github.com/gtrush03/synth-order-desk\nDemo: https://trusynth-order-desk.pages.dev/\n';
 const raw=Buffer.from(`From: Synth <${ACCOUNT}>\r\nTo: ${ACCOUNT}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(text).toString('base64')}\r\n`).toString('base64url');
 let attempt:any=null;try{attempt=JSON.parse(await readFile(`${dir}/attempt.json`,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(attempt&&!attempt.messageId)throw Error('The prior email attempt needs verification; no automatic resend.');
 if(!attempt){let used=0;try{used=JSON.parse(await readFile(`${parent}/attempt-count.json`,'utf8')).used;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}if(!Number.isInteger(used)||used<0||used>=6)throw Error('The six approved owner-email demo attempts are exhausted.');
 attempt={fingerprint:kit.fingerprint,createdAt:new Date().toISOString()};await writeFile(`${dir}/attempt.json`,JSON.stringify(attempt),{flag:'wx',mode:0o600}).catch(()=>{throw Error('The prior email attempt needs verification; no automatic resend.');});await writeFile(`${parent}/attempt-count.json`,JSON.stringify({used:used+1}),{mode:0o600});
 const sent=JSON.parse(await run(['gmail','users','messages','send','--params',JSON.stringify({userId:'me'}),'--json',JSON.stringify({raw})]));if(typeof sent.id!=='string')throw Error('Gmail has not confirmed sending; inspect the existing attempt.');attempt.messageId=sent.id;await writeFile(`${dir}/attempt.json`,JSON.stringify(attempt),{mode:0o600});}
 const check=JSON.parse(await run(['gmail','users','messages','get','--params',JSON.stringify({userId:'me',id:attempt.messageId,format:'metadata'})]));
 const recipient=check.payload?.headers?.find((h:any)=>h.name?.toLowerCase()==='to')?.value;if(!check.labelIds?.includes('SENT')||recipient!==ACCOUNT)throw Error('The sent-message readback did not match; do not resend.');
 const receipt:ProjectEmailReceipt={sent:true,recipient:ACCOUNT,messageId:attempt.messageId,fingerprint:kit.fingerprint,createdAt:new Date().toISOString(),reused:false,deliveryConfirmed:false};await writeFile(file,JSON.stringify(receipt,null,2),{mode:0o600});return receipt;
}

import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isCurrentPacket,type ConversationState} from './conversation-model.ts';
import type {CompanyData} from './company-workspace.ts';

export const TICKET_REPO='gtrush03/synth-order-desk';
const execute=promisify(execFile);
type Github=(args:string[])=>Promise<string>;
const github:Github=async args=>(await execute('/opt/homebrew/bin/gh',args,{timeout:25000,maxBuffer:128000})).stdout;
export interface LaunchKit {fingerprint:string;quantity:number;approvalRevision:number;title:string;email:{subject:string;body:string};social:{text:string};markdown:string}
export interface WorkTicket {number:number;url:string;fingerprint:string;publishedAt:string;reused:boolean;repo:string}
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);

export function prepareLaunchKit(state:ConversationState,company:CompanyData):LaunchKit {
  const approval=state.rehearsal.approved;
  if(!approval||!state.approvalRevision||!state.artifacts.some(artifact=>artifact.name.startsWith('Approved work packet')&&isCurrentPacket(state,artifact)))throw new Error('Approve the current proposal and write its work packet before preparing the handoff.');
  if(company.sampleData!==true)throw new Error('This public demonstration accepts labelled sample company data only.');
  const fingerprint=createHash('sha256').update(JSON.stringify({company:company.id,source:state.dataRevision,conversation:state.id,revision:state.approvalRevision,approval})).digest('hex');
  const title=`DEMO-001 · ${approval.quantity} shirts · approved production handoff`;
  const email={subject:`Availability inquiry — ${approval.quantity} ${company.product}`,
    body:`Hello,\n\nCould you confirm availability, production timing and delivery options for ${approval.quantity} ${company.product}, with a requested arrival of ${company.deadline}?\n\nOur internal sample plan uses ${approval.option.toLowerCase()} with a budgeted total of ${money(approval.totalCents)}. These are planning figures, not a supplier quote or a purchase order. Please confirm your actual pricing before we make any commitment.\n\nThank you,\n${company.name}\n\nHackathon demonstration using sample order data. This inquiry has not been sent.`};
  const social={text:`Behind the scenes at ${company.name}: turning a last-minute merchandise change into a clear plan. ${approval.quantity} ${company.product}, one approved handoff, and the details kept together.\n\nDemonstration with sample data. Draft for review; no availability or delivery promise. #MerchStudio #BuildInPublic`};
  const markdown=`# ${title}\n\n**Demonstration data · approved internal plan · nothing purchased or sent**\n\n## Production handoff\n\n- Quantity: ${approval.quantity} ${company.product}\n- Requested arrival: ${company.deadline}\n- Internal option: ${approval.option}\n- Sample total: ${money(approval.totalCents)}\n- Approval revision: ${state.approvalRevision}\n\n## Supplier email — unsent\n\nSubject: ${email.subject}\n\n${email.body}\n\n## Social post — unpublished\n\n${social.text}\n\n## Next real work\n\n1. Verify the supplier’s actual availability, quote and delivery terms.\n2. Review the inquiry and choose its recipient before sending.\n3. Review the launch copy and choose the social account before publishing.\n\nThe public work ticket records the approved internal handoff. It does not send this email, publish to a social network, or place an order.\n\n<!-- SYNTH-TICKET:${fingerprint} -->\n`;
  return {fingerprint,quantity:approval.quantity,approvalRevision:state.approvalRevision,title,email,social,markdown};
}

function ticketUrl(value:string){const match=value.trim().match(/^https:\/\/github\.com\/gtrush03\/synth-order-desk\/issues\/(\d+)$/);if(!match)throw new Error('GitHub did not return a verified project ticket.');return {url:value.trim(),number:Number(match[1])};}

export async function publishWorkTicket(root:string,kit:LaunchKit,run:Github=github):Promise<WorkTicket>{
  const allowance=JSON.parse(await readFile(`${root}/work-ticket-allowance.json`,'utf8').catch(()=>'null'));
  if(!allowance?.enabled||allowance.repo!==TICKET_REPO||allowance.sampleOnly!==true||!Number.isFinite(Date.parse(allowance.validUntil))||Date.parse(allowance.validUntil)<=Date.now()||!Number.isInteger(allowance.maxIssues)||allowance.maxIssues<1||allowance.maxIssues>6)throw new Error('Public work-ticket publishing is not enabled for this demo workspace.');
  if(!/^[a-f0-9]{64}$/.test(kit.fingerprint)||!kit.markdown.includes(`<!-- SYNTH-TICKET:${kit.fingerprint} -->`))throw new Error('The handoff identity is invalid.');
  const directory=`${root}/work-tickets`;await mkdir(directory,{recursive:true});
  const receiptPath=`${directory}/${kit.fingerprint}.json`;
  const saved=JSON.parse(await readFile(receiptPath,'utf8').catch(()=>'null'));
  if(saved?.fingerprint===kit.fingerprint&&saved.repo===TICKET_REPO){ticketUrl(saved.url);return {...saved,reused:true};}
  if((await run(['api','user','--jq','.login'])).trim()!=='gtrush03')throw new Error('The expected project owner is not signed into GitHub.');
  const matches=JSON.parse(await run(['issue','list','--repo',TICKET_REPO,'--state','all','--json','number,url,body','--limit','100'])) as {url:string;body:string}[];
  const existing=matches.find(issue=>issue.body.includes(`<!-- SYNTH-TICKET:${kit.fingerprint} -->`));
  if(existing){const receipt={...ticketUrl(existing.url),fingerprint:kit.fingerprint,publishedAt:new Date().toISOString(),reused:true,repo:TICKET_REPO};await writeFile(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});return receipt;}
  const pendingPath=`${directory}/${kit.fingerprint}.pending`;
  if(await readFile(pendingPath,'utf8').then(()=>true).catch(()=>false))throw new Error('A previous publication needs verification. A duplicate ticket was not created.');
  const countPath=`${root}/work-ticket-count.json`,count=JSON.parse(await readFile(countPath,'utf8').catch(()=>'{}'));
  const used=count.used??0;if(!Number.isInteger(used)||used<0||used>=allowance.maxIssues)throw new Error('The bounded public-ticket allowance is exhausted.');
  // Count attempts before the remote action. A retry first searches its stable identity.
  await writeFile(countPath,JSON.stringify({used:used+1,updatedAt:new Date().toISOString()}),{mode:0o600});
  const bodyPath=`${directory}/${kit.fingerprint}.md`;await writeFile(bodyPath,kit.markdown,{mode:0o600});
  await writeFile(pendingPath,new Date().toISOString(),{mode:0o600,flag:'wx'});
  const result=await run(['issue','create','--repo',TICKET_REPO,'--title',kit.title,'--body-file',bodyPath]);
  const receipt:WorkTicket={...ticketUrl(result),fingerprint:kit.fingerprint,publishedAt:new Date().toISOString(),reused:false,repo:TICKET_REPO};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2),{mode:0o600});return receipt;
}

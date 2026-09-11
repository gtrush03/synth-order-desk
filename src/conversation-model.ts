import { initialRehearsal, reviewSample, approveSample, type Rehearsal } from './rehearsal-model.ts';
export interface Intent { action: 'review'|'explain'|'approve'|'remember'|'draft'|'chat'|'launch'|'publish'|'browse'; quantity?: number|null; budgetDollars?: number|null; memoryNote?: string|null }
export interface ConversationMessage { role:'user'|'assistant'; text:string; at:string }
/** Optional model fields do not authorize changes absent from the user's utterance. */
export function sanitizeIntent(intent:Intent,message:string):Intent {
  const result={...intent};
  if(!['launch','publish'].includes(result.action)&&!/\$|budget|dollars|cost|spend|under|within/i.test(message))result.budgetDollars=null;
  // Never erase a potential quantity amendment at an external-action boundary.
  // Its exact-current-approval guard must see it, including unfamiliar number words.
  if(!['launch','publish'].includes(result.action)&&!/\d|\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|double|half)\b/i.test(message))result.quantity=null;
  if(result.action!=='remember')result.memoryNote=null;
  return result;
}
export interface ConversationEvent { id:string; label:string; detail:string; at:string }
export interface ConversationState { dataRevision?:string; companyName?:string; source?:string; approvalRevision?:number|null; cloudReview?:{fingerprint:string;receiptId:string}|null; id:string; revision:number; quantity:number; budgetCents:number; rehearsal:Rehearsal; notes:string[]; messages:ConversationMessage[]; events:ConversationEvent[]; artifacts:{id:string;name:string;url:string;approvalRevision?:number;approval?:{quantity:number;totalCents:number;option:string}}[] }
export const newConversation = (id:string):ConversationState => ({id,revision:0,quantity:100,budgetCents:180000,rehearsal:initialRehearsal(),notes:[],messages:[],events:[],artifacts:[]});
export function isCurrentPacket(state:ConversationState,artifact:ConversationState['artifacts'][number]){
  const current=state.rehearsal.approved,approved=artifact.approval;
  return Boolean(current&&approved&&artifact.approvalRevision!=null&&artifact.approvalRevision===state.approvalRevision&&approved.quantity===current.quantity&&approved.totalCents===current.totalCents&&approved.option===current.option);
}
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);
export function refreshCompanyContext(previous:ConversationState,sourceSha:string,notes:string[]) {
  const state=structuredClone(previous);
  const changed=state.dataRevision!==undefined&&state.dataRevision!==sourceSha||JSON.stringify(state.notes)!==JSON.stringify(notes);
  if(changed){state.rehearsal.approved=null;state.rehearsal.proposal=null;state.cloudReview=null;state.approvalRevision=null;}
  state.notes=[...notes];state.dataRevision=sourceSha;return state;
}
export function applyIntent(previous:ConversationState, intent:Intent, message:string, company?:import('./company-workspace.ts').CompanyData) {
  const state=structuredClone(previous); const at=new Date().toISOString();
  const deadline=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',timeZone:'UTC'}).format(new Date((company?.deadline??'2026-09-18')+'T12:00:00Z'));
  const events:ConversationEvent[]=[];
  const event=(id:string,label:string,detail:string)=>events.push({id,label,detail,at});
  if (!['review','explain','approve','remember','draft','chat','launch','publish','browse'].includes(intent.action)) throw new Error('The request needs clarification.');
  if(['launch','publish'].includes(intent.action)&&((intent.quantity!=null&&intent.quantity!==state.quantity)||(intent.budgetDollars!=null&&Math.round(intent.budgetDollars*100)!==state.budgetCents)))throw new Error('Review and approve that changed order before preparing or publishing its handoff.');
  let changed=false;
  if (['review','approve','draft'].includes(intent.action)) {
    if (intent.quantity!=null) {
      if (!Number.isInteger(intent.quantity)||intent.quantity<1||intent.quantity>200) throw new Error('This demo supports orders of 1 to 200 shirts. What quantity should I check?');
      changed ||= intent.quantity!==state.quantity; state.quantity=intent.quantity;
    }
    if (intent.budgetDollars!=null) {
      const cents=Math.round(intent.budgetDollars*100);
      if (!Number.isFinite(intent.budgetDollars)||cents<0||cents>1000000) throw new Error('What sample budget should I use, between zero and ten thousand dollars?');
      changed ||= cents!==state.budgetCents; state.budgetCents=cents;
    }
  }
  let reply:string|null=null; let draft:string|null=null;
  if (intent.action==='review' || (['approve','draft'].includes(intent.action) && changed)) {
    state.cloudReview=null;
    state.approvalRevision=null;
    state.rehearsal=reviewSample(state.rehearsal,state.quantity,state.budgetCents,company);
    applyCompanyPolicy(state);
    const p=state.rehearsal.proposal!,c=p.chosen;
    event('local-options','Checked the sample order',`${p.quantity} shirts; ${money(p.budgetCents)} budget; ${deadline} deadline. Three fulfillment options calculated from the current company source.`);
    reply=c ? `For ${p.quantity} shirts, ${c.name.toLowerCase()} fits the ${deadline} deadline at ${money(c.totalCents)}, leaving ${money(p.budgetCents-c.totalCents)} in the budget. ${c.id==='split'?'Standard arrives too late, and express costs '+money(p.options.find(o=>o.id==='express')!.totalCents)+'. ':''}Would you like to approve this proposal?` : `None of the three options satisfies your company shipment rule together with the ${money(p.budgetCents)} budget and the ${deadline} deadline. We can change the quantity or budget. What would you like to adjust?`;
    if (state.notes.length) reply += ` Your company instruction is: ${state.notes.at(-1)}`;
  } else if (intent.action==='approve') {
    const negative=/\b(don['’]?t|do not|not yet|never|no|hold|cancel|without|should|would|could|can|why|how)\b/i.test(message);
    const explicit=/\b(approve|approved|confirm|yes|go ahead|sounds good|that works)\b/i.test(message);
    if (negative||!explicit) { reply='I have not approved anything. Tell me explicitly when you want to approve the current proposal.'; }
    else if (!state.rehearsal.proposal?.chosen) reply='I need to check a feasible proposal first. What quantity and budget should I use?';
    else {
      state.rehearsal=approveSample(state.rehearsal);
      state.approvalRevision=state.revision+1;
      event('local-approval','Recorded your proposal approval',`${state.rehearsal.approved!.quantity} shirts at ${money(state.rehearsal.approved!.totalCents)}. Local demo record; no purchase or message.`);
      reply=`I've recorded your approval for ${state.rehearsal.approved!.quantity} shirts at ${money(state.rehearsal.approved!.totalCents)}. Shall I write the customer reply?`;
    }
  } else if (intent.action==='remember') {
    const note=(intent.memoryNote||message).trim().slice(0,400);
    if (!note) throw new Error('What would you like me to remember?');
    state.notes=[...state.notes.filter(existing=>existing!==note),note].slice(-12);
    event('local-memory','Saved a company instruction',note);
    const hadProposal=Boolean(state.rehearsal.proposal);
    state.rehearsal.proposal=null;state.rehearsal.approved=null;state.cloudReview=null;state.approvalRevision=null;
    reply=`I'll remember that for future requests at this company: ${note}${hadProposal?' Please ask me to review the order again with this instruction before approving it.':''}`;
  } else if (intent.action==='explain') {
    const p=state.rehearsal.proposal;
    if(company&&/inventory|stock|reservations?|reserved|held|quality.hold|warehouses?/i.test(message)){
      const lots=company.stockLots??[],reserved=lots.reduce((sum,l)=>sum+l.reserved,0),held=lots.filter(l=>l.status!=='ready'||l.readyBy>company.deadline).reduce((sum,l)=>sum+l.available-l.reserved,0);
      reply=`There are ${company.stock.available} ${company.product} available for this plan${lots.length?` across ${new Set(lots.map(l=>l.location)).size} locations and ${lots.length} stock lots`:''}. ${reserved} items are reserved and ${held} are held or arrive after the deadline, so they are excluded. Ready stock costs ${money(company.stock.unitCents)} per unit; rush stock costs ${money(company.stock.rushUnitCents)}. What quantity and budget should I check?`;
    }
    else if (!p) reply='I can compare stock, cost and delivery for the sample order. What quantity should I check?';
    else {
      const standard=p.options.find(o=>o.id==='standard')!,express=p.options.find(o=>o.id==='express')!,split=p.options.find(o=>o.id==='split')!;
      reply=`Standard is ${money(standard.totalCents)} and arrives ${standard.arrival}. Express is ${money(express.totalCents)} and arrives ${express.arrival}; split shipment is ${money(split.totalCents)} and arrives ${split.arrival}. ${p.chosen ? `${p.chosen.name} is the cheapest option that meets your date, budget and company shipment rule.`:'No option satisfies the date, budget and company shipment rule together.'}`;
    }
  } else if (intent.action==='draft') {
    const p=state.rehearsal.proposal,c=p?.chosen;
    if (!p||!c) reply='Let me check a feasible proposal before writing the customer reply. What quantity and budget should I use?';
    else {
      draft=`# Customer reply — draft\n\n${company?.sampleData!==false?'Demonstration data':'Company data'} · ${company?.name??'Demo company'} · source ${state.dataRevision?.slice(0,12)??'built-in fixture'}\n\nHello,\n\nWe can provide ${p.quantity} ${company?.product??'black T-shirts'} by ${company?.deadline??'2026-09-18'} using ${c.name.toLowerCase()}, for a proposed total of ${money(c.totalCents)}. Please let us know if you would like to proceed.\n\nThank you,\n${company?.name??'TRU Synth demo company'}\n\n---\n${state.rehearsal.approved?'Owner approval is recorded for this proposal.':'Owner approval is still required.'} Quote revision ${state.revision+1}. This local draft has not been sent. No payment, order or shipment has been arranged.\n`;
      reply=`I've prepared the customer reply for ${p.quantity} shirts at ${money(c.totalCents)}. It's saved in this demo's workspace, ready for you to read.`;
      event('local-draft','Created a customer-reply draft','Local Markdown artifact. Nothing sent.');
    }
  }
  state.events.push(...events);
  return {state,reply,draft,events};
}

/** A recognized instruction returns whether split shipments are forbidden. */
export function shipmentPolicyInstruction(note:string):boolean|null {
  // Preserve the policy engine's existing precedence if both forms occur.
  if(/(?:allow|permit)\s+split|split shipments? (?:is|are) (?:okay|ok|allowed)/i.test(note))return false;
  if(/(?:never|do not|don't|no)\s+(?:use\s+)?split|single shipment only/i.test(note))return true;
  return null;
}
export function splitForbidden(notes:string[]) {
  let forbidden=false;
  for(const note of notes){const instruction=shipmentPolicyInstruction(note);if(instruction!==null)forbidden=instruction;}
  return forbidden;
}
/** Only an actual contradictory instruction supersedes a shipment rule. */
export function historicalShipmentPolicyIndexes(notes:string[]):number[] {
  const policies=notes.map(shipmentPolicyInstruction);
  let latest=policies.length-1;
  while(latest>=0&&policies[latest]===null)latest--;
  if(latest<0)return [];
  return policies.flatMap((value,index)=>index<latest&&value!==null&&value!==policies[latest]?[index]:[]);
}
export function applyCompanyPolicy(state:ConversationState){
  const proposal=state.rehearsal.proposal;
  if(proposal&&splitForbidden(state.notes))proposal.chosen=proposal.options.filter(o=>o.id!=='split'&&o.onTime&&o.withinBudget).sort((a,b)=>a.totalCents-b.totalCents)[0]??null;
}

/** Pure sample-data logic. No network, storage, credentials or vendor SDKs. */
export interface SampleOption { id: 'standard' | 'express' | 'split'; name: string; totalCents: number; arrival: string; onTime: boolean; withinBudget: boolean; explanation: string }
export interface SampleProposal { quantity: number; budgetCents: number; options: SampleOption[]; chosen: SampleOption | null }
export interface DemoApproval { quantity: number; totalCents: number; option: string }
export interface Rehearsal { proposal: SampleProposal | null; approved: DemoApproval | null; memory: DemoApproval[] }
export const initialRehearsal = (): Rehearsal => ({ proposal: null, approved: null, memory: [] });
export function sampleProposal(quantity: number, budgetCents: number, company?: import('./company-workspace.ts').CompanyData): SampleProposal {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw new Error('Use a whole quantity from 1 to 200 for this sample.');
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 0 || budgetCents > 1_000_000) throw new Error('Use a sample budget from $0 to $10,000, with at most two decimal places.');
  const stock = Math.min(quantity, company?.stock.available ?? 100), rush = Math.max(0, quantity - stock);
  const rows = company ? company.shipping.map(rate=>({id:rate.id,name:rate.name,totalCents:rate.id==='split'?stock*company.stock.unitCents+rush*company.stock.rushUnitCents+rate.shippingCents:quantity*rate.unitCents+rate.shippingCents,arrival:rate.arrival,onTime:rate.arrival<=company.deadline,explanation:rate.id==='split'?`${stock} from stock + ${rush} rush units + shipping; company source ${company.id}`:`${quantity} units + shipping; company source ${company.id}`})) : [
    { id: 'standard' as const, name: 'Standard', totalCents: quantity * 1000 + 15000, arrival: 'Sep 21', onTime: false, explanation: `${quantity} × $10 + $150 sample shipping` },
    { id: 'express' as const, name: 'Express', totalCents: quantity * 1000 + 45000, arrival: 'Sep 18', onTime: true, explanation: `${quantity} × $10 + $450 sample shipping` },
    { id: 'split' as const, name: 'Split shipment', totalCents: stock * 900 + rush * 1200 + 25000, arrival: 'Sep 18', onTime: true, explanation: `${stock} in stock × $9 + ${rush} rush × $12 + $250 sample shipping` }
  ];
  const options = rows.map(row => ({ ...row, withinBudget: row.totalCents <= budgetCents }));
  const chosen = options.filter(option => option.onTime && option.withinBudget).sort((a,b) => a.totalCents - b.totalCents)[0] ?? null;
  return { quantity, budgetCents, options, chosen };
}
export function reviewSample(state: Rehearsal, quantity: number, budgetCents: number, company?: import('./company-workspace.ts').CompanyData): Rehearsal {
  return { proposal: sampleProposal(quantity, budgetCents, company), approved: null, memory: state.memory };
}
export function invalidateSample(state: Rehearsal): Rehearsal {
  return { proposal: null, approved: null, memory: state.memory };
}
export function approveSample(state: Rehearsal): Rehearsal {
  if (!state.proposal?.chosen) throw new Error('A feasible reviewed proposal is required before demo approval.');
  if (state.approved) return state;
  const approved = { quantity: state.proposal.quantity, totalCents: state.proposal.chosen.totalCents, option: state.proposal.chosen.name };
  return { ...state, approved, memory: [...state.memory, approved] };
}
export function replaySample(state: Rehearsal): Rehearsal {
  if (!state.memory.length || !state.proposal) throw new Error('Approve the first demo proposal before rehearsing reuse.');
  return reviewSample(state, 140, state.proposal.budgetCents);
}

import { createHash } from 'node:crypto';
import type { ConversationState } from './conversation-model.ts';
import type { CompanyData } from './company-workspace.ts';

// A cloud check is valid for one exact proposal and the company facts that produced it.
export function reviewFingerprint(state:ConversationState,company:CompanyData) {
  const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted((v as Record<string,unknown>)[k])])):v;
  return createHash('sha256').update(JSON.stringify(sorted({company,notes:state.notes,quantity:state.quantity,budgetCents:state.budgetCents,proposal:state.rehearsal.proposal}))).digest('hex');
}
export function hasCurrentCloudReview(state:ConversationState,company:CompanyData) {
  return Boolean(state.rehearsal.proposal&&state.cloudReview?.receiptId&&state.cloudReview.fingerprint===reviewFingerprint(state,company));
}

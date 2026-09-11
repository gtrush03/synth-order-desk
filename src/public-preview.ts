import type {CompanyData} from './company-workspace.ts';
import {sampleProposal} from './rehearsal-model.ts';
/** Public experiment: identical calculation, no provider call or external action. */
export function previewScenario(company:CompanyData,quantity:number,budgetDollars:number,oneShipment=false){
  const result=sampleProposal(quantity,Math.round(budgetDollars*100),company);
  if(oneShipment)result.chosen=result.options.filter(o=>o.id!=='split'&&o.onTime&&o.withinBudget).sort((a,b)=>a.totalCents-b.totalCents)[0]??null;
  return result;
}

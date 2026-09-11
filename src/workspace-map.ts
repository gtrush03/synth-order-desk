import type {CompanyData,CompanyMemory} from './company-workspace.ts';
import {historicalShipmentPolicyIndexes} from './conversation-model.ts';

/** The explorer reads the same source as the actual order review. */
export function workspaceMap(source:{data:CompanyData;sha256:string;memory:CompanyMemory}){
  const {data:c,memory,sha256}=source,historical=new Set(historicalShipmentPolicyIndexes(memory.notes));
  return {
    title:`${c.name} · launch workspace`,description:'Explore the facts. Ask what changes. Approve the work you want to happen.',sampleData:c.sampleData,source:c.source,sourceSha:sha256,product:c.product,deadline:c.deadline,
    inventory:c.stockLots?.map(l=>({label:`${l.location} · ${l.variant}`,available:l.available-l.reserved,reserved:l.reserved,unitCents:l.unitCents,kind:l.status==='ready'&&l.readyBy<=c.deadline?'ready':'held',readyBy:l.readyBy}))??[{label:c.product,available:c.stock.available,reserved:0,unitCents:c.stock.unitCents,kind:'ready',readyBy:c.deadline}],
    stock:c.stock,shipping:c.shipping,
    instructions:memory.notes.map((text,i)=>({text,active:!historical.has(i)})),
    starterRequests:[
      {label:'Plan the launch',message:`Review 150 ${c.product} with a budget of $1800.`},
      {label:'Explore the stock',message:'Explain the available inventory, reservations and held stock in this workspace.'},
      {label:'Check the supplier',message:'Check the supplier website.'}
    ],
    context:[{label:'Deliver by',value:c.deadline,detail:'Every option is checked against this deadline.'},{label:'Ready stock',value:String(c.stock.available),detail:'Reservations and quality holds are excluded.'},{label:'Rush unit',value:`$${(c.stock.rushUnitCents/100).toFixed(2)}`,detail:'Used when a split shipment needs more than ready stock.'},{label:'Source rows',value:String((c.stockLots?.length??1)+c.shipping.length+1),detail:'Inventory lots, delivery rates, and the deadline plus saved policy record.'}],
    capabilities:['Explore stock and delivery constraints','Compare quantities and budgets','Remember a shipment rule across conversations','Approve a plan and create its work packet','Prepare supplier email and social drafts','Publish the approved work ticket']
  };
}

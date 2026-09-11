import type { CompanyMemory } from './company-workspace.ts';
const BASE='http://127.0.0.1:8765',NAME='hackathon-orderdesk-20260911';
async function request(path:string,options:RequestInit={}){const r=await fetch(BASE+path,{...options,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Cognee returned HTTP ${r.status}.`);return r;}
async function dataset(){const all=await(await request('/api/v1/datasets')).json() as {id:string;name:string}[];return all.find(d=>d.name===NAME);}
export async function saveCognee(memory:CompanyMemory){
 const form=new FormData();form.append('datasetName',NAME);form.append('data',new Blob([JSON.stringify(memory)],{type:'text/plain'}),`company-memory-r${memory.revision}.txt`);form.append('labels',JSON.stringify(['orderdesk-company-memory']));form.append('external_metadata',JSON.stringify([{revision:memory.revision,source:'local owner conversation',app:'synth-orderdesk'}]));
 await request('/api/v1/add',{method:'POST',body:form});
 const d=await dataset();if(!d)throw new Error('Cognee did not return the company dataset.');
 return {engine:'Cognee dataset memory',datasetId:d.id,revision:memory.revision,cloudModelCalls:0,graphCompletion:false};
}
export async function recallCognee():Promise<{memory:CompanyMemory;datasetId:string;dataId:string}|null>{
 const d=await dataset();if(!d)return null;
 const items=await(await request(`/api/v1/datasets/${d.id}/data`)).json() as {id:string;label?:string;externalMetadata?:{revision?:number;app?:string}}[];
 const latest=items.filter(i=>i.label==='orderdesk-company-memory'&&i.externalMetadata?.app==='synth-orderdesk'&&Number.isInteger(i.externalMetadata.revision)).sort((a,b)=>b.externalMetadata!.revision!-a.externalMetadata!.revision!)[0];
 if(!latest)return null;
 const memory=await(await request(`/api/v1/datasets/${d.id}/data/${latest.id}/raw`)).json() as CompanyMemory;
 if(memory.schema!==1||memory.revision!==latest.externalMetadata!.revision||!Array.isArray(memory.notes)||memory.notes.some(n=>typeof n!=='string'||n.length>400)||!Array.isArray(memory.approvals))throw new Error('Cognee company memory failed validation.');
 return {memory,datasetId:d.id,dataId:latest.id};
}

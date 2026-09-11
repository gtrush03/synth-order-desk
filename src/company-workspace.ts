import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ConversationState } from './conversation-model.ts';
import { StateError } from './state.ts';
export interface CompanyMemory {schema:1; revision:number; notes:string[]; approvals:{conversationId:string;quantity:number;totalCents:number;option:string;at:string}[]; updatedAt:string}
function validMemory(m:CompanyMemory){return m?.schema===1&&Number.isSafeInteger(m.revision)&&m.revision>=0&&Array.isArray(m.notes)&&m.notes.length<=24&&m.notes.every(n=>typeof n==='string'&&n.length<=400)&&Array.isArray(m.approvals)&&m.approvals.length<=100&&m.approvals.every(a=>a&&typeof a.conversationId==='string'&&Number.isInteger(a.quantity)&&a.quantity>=1&&a.quantity<=200&&Number.isSafeInteger(a.totalCents)&&a.totalCents>=0&&a.totalCents<=1000000&&typeof a.option==='string'&&a.option.length>0&&a.option.length<=120&&typeof a.at==='string')&&typeof m.updatedAt==='string'&&Number.isFinite(Date.parse(m.updatedAt));}
export class CompanyWorkspace {
  constructor(readonly directory:string){}
  async read():Promise<CompanyMemory> {
    try {const m=JSON.parse(await readFile(resolve(this.directory,'memory.json'),'utf8'));
      if(!validMemory(m))throw new Error('Invalid memory');return m;
    }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {schema:1,revision:0,notes:[],approvals:[],updatedAt:new Date().toISOString()};throw new StateError(503,'Company memory needs repair. The saved file was preserved.');}
  }
  async restoreIfNewer(candidate:CompanyMemory) {
    const current=await this.read();
    if(!validMemory(candidate))throw new StateError(503,'The stored company memory is invalid.');
    if(candidate.revision<=current.revision)return current;
    await mkdir(this.directory,{recursive:true});const target=resolve(this.directory,'memory.json'),pending=`${target}.${randomUUID()}.new`;
    await writeFile(pending,JSON.stringify(candidate,null,2)+'\n',{mode:0o600});await rename(pending,target);return candidate;
  }
  async merge(state:ConversationState) {
    const memory=await this.read();const notes=[...memory.notes.filter(note=>!state.notes.includes(note)),...state.notes].slice(-24);
    const approvals=[...memory.approvals];const a=state.rehearsal.approved;
    if(a&&!approvals.some(x=>x.conversationId===state.id&&x.quantity===a.quantity&&x.totalCents===a.totalCents&&x.option===a.option))approvals.push({conversationId:state.id,...a,at:new Date().toISOString()});
    if(JSON.stringify(notes)===JSON.stringify(memory.notes)&&approvals.length===memory.approvals.length)return memory;
    const updated={...memory,revision:memory.revision+1,notes,approvals:approvals.slice(-100),updatedAt:new Date().toISOString()};
    await mkdir(this.directory,{recursive:true});const target=resolve(this.directory,'memory.json'),pending=`${target}.${randomUUID()}.new`;
    await writeFile(pending,JSON.stringify(updated,null,2)+'\n',{mode:0o600});await rename(pending,target);return updated;
  }
}
export interface StockLot {id:string;location:string;variant:string;available:number;reserved:number;unitCents:number;rushUnitCents:number;readyBy:string;status:'ready'|'quality-hold'}
export interface CompanyData {schema:1;id:string;name:string;sampleData:boolean;source:string;product:string;deadline:string;stock:{available:number;unitCents:number;rushUnitCents:number};stockLots?:StockLot[];shipping:{id:'standard'|'express'|'split';name:string;unitCents:number;shippingCents:number;arrival:string}[]}
export function validateCompany(input:unknown):CompanyData {
  const d=input as CompanyData;
  const amount=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=1000000;
  if(!d||d.schema!==1||!d.stock||!Array.isArray(d.shipping)||d.shipping.length!==3||!['id','name','source','product','deadline'].every(k=>typeof (d as unknown as Record<string,unknown>)[k]==='string')||typeof d.sampleData!=='boolean')throw new Error('Invalid company data');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)||!amount(d.stock.available)||!amount(d.stock.unitCents)||!amount(d.stock.rushUnitCents))throw new Error('Invalid company inventory');
  if(new Set(d.shipping.map(s=>s.id)).size!==3||d.shipping.some(s=>!['standard','express','split'].includes(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||!amount(s.unitCents)||!amount(s.shippingCents)||!/^\d{4}-\d{2}-\d{2}$/.test(s.arrival)))throw new Error('Invalid company rates');
  if(d.stockLots!==undefined){
    if(!Array.isArray(d.stockLots)||d.stockLots.length<1||d.stockLots.length>60||new Set(d.stockLots.map(l=>l?.id)).size!==d.stockLots.length||d.stockLots.some(l=>!l||!['id','location','variant'].every(k=>typeof (l as unknown as Record<string,unknown>)[k]==='string'&&String((l as unknown as Record<string,unknown>)[k]).length>0&&String((l as unknown as Record<string,unknown>)[k]).length<=80)||!amount(l.available)||!amount(l.reserved)||l.reserved>l.available||l.unitCents!==d.stock.unitCents||l.rushUnitCents!==d.stock.rushUnitCents||!/^\d{4}-\d{2}-\d{2}$/.test(l.readyBy)||!['ready','quality-hold'].includes(l.status)))throw new Error('Invalid stock lots');
    const ready=d.stockLots.filter(l=>l.status==='ready'&&l.readyBy<=d.deadline).reduce((sum,l)=>sum+l.available-l.reserved,0);
    if(ready!==d.stock.available)throw new Error('Stock totals disagree with eligible lots');
  }
  return d;
}
export async function companyData(path:string){const raw=await readFile(path,'utf8');return {data:validateCompany(JSON.parse(raw)),sha256:createHash('sha256').update(raw).digest('hex')};}

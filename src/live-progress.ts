import { randomUUID } from 'node:crypto';

export type ProgressStatus='running'|'complete'|'error'|'reused';
export interface ProgressStep {id:string;sponsor:string;task:string;status:ProgressStatus;startedAt:string;finishedAt?:string;detail?:string}
export interface ProgressSnapshot {conversationId:string;runId:string;active:boolean;steps:ProgressStep[];updatedAt:string}
const current=new Map<string,ProgressSnapshot>();
const now=()=>new Date().toISOString();
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);

export class ProgressRun {
  constructor(private snapshot:ProgressSnapshot){}
  record(id:string,sponsor:string,task:string,status:ProgressStatus,detail?:string){
    if(!this.snapshot.active)return;
    const at=now(),prior=this.snapshot.steps.find(step=>step.id===id);
    const step:ProgressStep={id,sponsor,task,status,startedAt:prior?.startedAt??at,...(status==='running'?{}:{finishedAt:at}),...(detail?{detail}:{} )};
    if(prior)Object.assign(prior,step);else if(this.snapshot.steps.length<80)this.snapshot.steps.push(step);
    this.snapshot.updatedAt=at;
  }
  async run<T>(sponsor:string,task:string,work:()=>Promise<T>):Promise<T>{
    const id=`${sponsor}-${this.snapshot.steps.length}`;
    this.record(id,sponsor,task,'running');
    try{const result=await work();this.record(id,sponsor,task,'complete');return result;}
    catch(error){this.record(id,sponsor,task,'error','The task did not confirm completion.');throw error;}
  }
  end(){
    const at=now();
    for(const step of this.snapshot.steps)if(step.status==='running'){step.status='error';step.finishedAt=at;step.detail='The review ended before this task confirmed completion.';}
    this.snapshot.active=false;this.snapshot.updatedAt=at;
  }
}
export function beginProgress(conversationId:string){
  if(!validId(conversationId))throw new Error('Invalid progress conversation.');
  for(const [id,run] of current)if(!run.active&&Date.now()-Date.parse(run.updatedAt)>600000)current.delete(id);
  if(current.size>=32){const old=[...current].find(([,run])=>!run.active);if(old)current.delete(old[0]);}
  const snapshot:ProgressSnapshot={conversationId,runId:randomUUID(),active:true,steps:[],updatedAt:now()};
  current.set(conversationId,snapshot);return new ProgressRun(snapshot);
}
export function progressSnapshot(conversationId:unknown):ProgressSnapshot|null {
  if(!validId(conversationId))return null;
  const value=current.get(conversationId);
  return value?structuredClone(value):{conversationId,runId:'',active:false,steps:[],updatedAt:now()};
}

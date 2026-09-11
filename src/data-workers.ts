import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { validateCompany, type CompanyData } from './company-workspace.ts';
import { hotdataRequest, inlineCSV, HotdataError } from './hotdata-http.ts';
export interface WorkerReceipt {role:string;databaseId:string;catalog:string;tables:string[];query:string;resultRows?:Record<string,unknown>[];startedAt:string;finishedAt:string;rows:number;queryRunId?:string;destroyed:boolean}
export interface DataReceipt {id:string;engine:'local company files'|'Hotdata'|'verified Hotdata snapshot';reusedFrom?:string;sourceQueriedAt?:string;sourceSha256:string;startedAt:string;finishedAt:string;workers:WorkerReceipt[];queryOverlapMs:number;isolationProbe?:{databaseId:string;foreignCatalog:string;denied:boolean;status:number;detail:string};failure?:string;paidCalls:number|null}
interface Allowance {enabled:boolean;workspaceId:string;freeCreditConfirmed:boolean;confirmedAvailableUsd:number;maxInputBytes:number;validUntil:string;maxRuns:number;proof:string}
export interface DataProgress {id:string;task:string;status:'running'|'complete'|'error'|'reused';detail?:string}
function rows(result:unknown):Record<string,unknown>[] {
  const r=result as {columns:unknown;rows:unknown;truncated?:boolean;row_count?:number;total_row_count?:number};
  if(!r||r.truncated===true||!Array.isArray(r.columns)||!r.columns.every(x=>typeof x==='string')||new Set(r.columns).size!==r.columns.length||!Array.isArray(r.rows)||r.rows.some(x=>!Array.isArray(x)||x.length!==(r.columns as string[]).length)||r.row_count!=null&&r.row_count!==r.rows.length||r.total_row_count!=null&&r.total_row_count!==r.rows.length)throw new Error('Hotdata returned incomplete data.');
  return r.rows.map(row=>Object.fromEntries((r.columns as string[]).map((name,index)=>[name,row[index]])));
}
export async function runDataWorkers(root:string,company:CompanyData,notes:string[],sha256:string,request=hotdataRequest,observe?:(event:DataProgress)=>void) {
  const progress=(id:string,task:string,status:DataProgress['status'],detail?:string)=>{try{observe?.({id,task,status,detail});}catch{/* Observation cannot change the business result. */}};
  const id=randomUUID(),startedAt=new Date().toISOString(),directory=`${root}/receipts`;
  await mkdir(directory,{recursive:true});
  let allowance:Allowance|undefined;
  try{allowance=JSON.parse(await readFile(`${root}/hotdata-allowance.json`,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Hotdata allowance is invalid.');}
  const receipt:DataReceipt={id,engine:'local company files',sourceSha256:sha256,startedAt,finishedAt:startedAt,workers:[],queryOverlapMs:0,paidCalls:0};
  const notesHash=createHash('sha256').update(JSON.stringify(notes)).digest('hex');
  if(allowance?.enabled){
    try{const cached=JSON.parse(await readFile(`${root}/verified-data.json`,'utf8'));
      if(cached.sha256===sha256&&cached.notesHash===notesHash&&Date.now()-Date.parse(cached.queriedAt)<300000){receipt.engine='verified Hotdata snapshot';receipt.reusedFrom=cached.receiptId;receipt.sourceQueriedAt=cached.queriedAt;await writeFile(`${directory}/${id}.json`,JSON.stringify(receipt,null,2),{mode:0o600});progress('hotdata-cache','Reuse the verified company snapshot','reused','No new Hotdata query; source is under five minutes old.');return {company:validateCompany(cached.company),notes:cached.notes as string[],receipt};}
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('The cached company snapshot is invalid.');}
  }
  if(!allowance?.enabled){await writeFile(`${directory}/${id}.json`,JSON.stringify(receipt,null,2),{mode:0o600});return {company,notes,receipt};}
  if(!allowance.freeCreditConfirmed||allowance.confirmedAvailableUsd<20||allowance.maxInputBytes!==25000||!allowance.proof||!/^work[a-z0-9]+$/.test(allowance.workspaceId)||Date.parse(allowance.validUntil)<=Date.now()||!Number.isInteger(allowance.maxRuns)||allowance.maxRuns<1||allowance.maxRuns>20)throw new Error('Hotdata needs a current, verified free allowance before a run.');
  let used=0;try{used=JSON.parse(await readFile(`${root}/hotdata-run-count.json`,'utf8')).used;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(!Number.isInteger(used)||used>=allowance.maxRuns)throw new Error('The bounded Hotdata run allowance is exhausted.');
  // The conversation coordinator serializes this counter. Failed runs count too.
  await writeFile(`${root}/hotdata-run-count.json`,JSON.stringify({used:used+1,updatedAt:new Date().toISOString()}),{mode:0o600});
  receipt.engine='Hotdata';receipt.paidCalls=0;
  if(Buffer.byteLength(JSON.stringify({company,notes}),'utf8')>allowance.maxInputBytes)throw new Error('The free-credit run is limited to 25 KB of company input.');
  const workspace=allowance.workspaceId;
  const api=(method:string,path:string,body?:unknown)=>request(workspace,method,path,body);
  const configs=[
    {role:'inventory',table:'inventory',records:company.stockLots??[company.stock]},
    {role:'shipping',table:'rates',records:company.shipping},
    {role:'policy',table:'rules',records:[{deadline:company.deadline,notesJson:JSON.stringify(notes)}]}
  ];
  const completed:Record<string,unknown>[][]=[];
  const databases:{id:string;receipt:WorkerReceipt}[]=[];
  let failure:unknown;
  try {
    const prepared=await Promise.allSettled(configs.map(async (config,index)=>{
      const key=`hotdata-create-${config.role}`,task=`Prepare the ${config.role} database`;
      progress(key,task,'running');
      try{
      const catalog=`sd_${id.replaceAll('-','').slice(0,18)}_${config.role}`;
      const created=await api('POST','/v1/databases',{name:`Synth Order Desk ${config.role} ${id}`,default_catalog:catalog,default_schema:'public',schemas:[{name:'public',tables:[{name:config.table}]}],expires_at:'30m',if_not_exists:true}) as {id?:string;public_id?:string;database_id?:string};
      const db=created.id??created.public_id??created.database_id;if(typeof db!=='string'||!db)throw new Error('Hotdata did not return a database identifier.');
      const query=config.role==='inventory'&&company.stockLots?`SELECT SUM("available"-"reserved") AS "available", MIN("unitCents") AS "unitCents", MAX("rushUnitCents") AS "rushUnitCents" FROM ${catalog}.public.inventory WHERE "status" = 'ready' AND "readyBy" <= '${company.deadline}'`:`SELECT * FROM ${catalog}.public.${config.table}`;
      const wr:WorkerReceipt={role:config.role,databaseId:db,catalog,tables:[config.table],query,startedAt:'',finishedAt:'',rows:0,destroyed:false};
      databases.push({id:db,receipt:wr});receipt.workers.push(wr);
      await api('POST',`/v1/databases/${db}/schemas/public/tables/${config.table}/loads`,{...inlineCSV(config.records),mode:'replace',format:'csv',idempotency_key:`${id}-${config.role}`});
      progress(key,task,'complete',`Loaded ${config.records.length} rows of ${config.table}. Database ${db}.`);
      return {index,wr};
      }catch(error){progress(key,task,'error','Database preparation was not confirmed.');throw error;}
    }));
    const bad=prepared.find(x=>x.status==='rejected');if(bad?.status==='rejected')throw bad.reason;
    // All inputs are ready before the SQL wave starts. Each worker receives only its database ID and SQL, not the other workers' source tables.
    const queried=await Promise.allSettled(prepared.map(async result=>{
      if(result.status!=='fulfilled')throw new Error('Worker did not prepare');const {index,wr}=result.value;
      wr.startedAt=new Date().toISOString();
      const key=`hotdata-query-${wr.role}`,task=`Query ${wr.role}`;progress(key,task,'running');
      try{const result=await api('POST','/v1/query',{database_id:wr.databaseId,sql:wr.query,dialect:'duckdb',async:false}) as {query_run_id?:string};completed[index]=rows(result);wr.queryRunId=result.query_run_id;wr.rows=completed[index].length;wr.resultRows=completed[index];progress(key,task,'complete',`${wr.rows} returned rows; query ${wr.queryRunId??'confirmed'}.`);}catch(error){progress(key,task,'error','The query did not return valid complete rows.');throw error;}finally{wr.finishedAt=new Date().toISOString();}
    }));
    const badQuery=queried.find(x=>x.status==='rejected');if(badQuery?.status==='rejected')throw badQuery.reason;
    receipt.queryOverlapMs=Math.max(0,Math.min(...receipt.workers.map(w=>Date.parse(w.finishedAt)))-Math.max(...receipt.workers.map(w=>Date.parse(w.startedAt))));
    const inventoryWorker=receipt.workers.find(w=>w.role==='inventory')!,shippingWorker=receipt.workers.find(w=>w.role==='shipping')!;
    progress('hotdata-isolation','Verify the inventory worker cannot read shipping data','running');
    try{await api('POST','/v1/query',{database_id:inventoryWorker.databaseId,sql:`SELECT * FROM ${shippingWorker.catalog}.public.rates`,dialect:'duckdb',async:false});throw new Error('An inventory worker could unexpectedly read the shipping catalog.');}catch(error){if(!(error instanceof HotdataError)||error.status!==400&&error.status!==404&&error.status!==422)throw error;if(!/catalog|not found|does not exist/i.test(error.detail))throw new Error('The negative scope probe failed for an unrecognized reason.');receipt.isolationProbe={databaseId:inventoryWorker.databaseId,foreignCatalog:shippingWorker.catalog,denied:true,status:error.status,detail:error.detail};}
    progress('hotdata-isolation','Verify the inventory worker cannot read shipping data','complete','The foreign catalog query was denied.');
    if(completed[0].length!==1||completed[1].length!==3||completed[2].length!==1)throw new Error('The data workers returned unexpected business rows.');
  }catch(error){failure=error;receipt.failure=(error as Error).message+(error instanceof HotdataError&&error.detail?' '+error.detail:'');}
  finally {
    // A timed-out create can still have succeeded server-side. Reconcile only
    // this unique run's three names before cleanup; never touch another run.
    if(failure&&databases.length<configs.length){
      try{
        const listed=await api('GET',`/v1/databases?search=${encodeURIComponent(id)}&limit=100`) as {databases:{id:string;name:string}[];has_more:boolean};
        if(!Array.isArray(listed.databases)||listed.has_more)throw new Error('Incomplete reconciliation');
        for(const db of listed.databases){
          const config=configs.find(c=>db.name===`Synth Order Desk ${c.role} ${id}`);
          if(config&&!databases.some(d=>d.id===db.id)){
            const catalog=`sd_${id.replaceAll('-','').slice(0,18)}_${config.role}`;
            const wr:WorkerReceipt={role:config.role,databaseId:db.id,catalog,tables:[config.table],query:`SELECT * FROM ${catalog}.public.${config.table}`,startedAt:'',finishedAt:'',rows:0,destroyed:false};
            databases.push({id:db.id,receipt:wr});receipt.workers.push(wr);
          }
        }
      }catch{receipt.failure=(receipt.failure??'')+' A timed-out create could not be reconciled; best-effort expiry is configured.';}
    }
    const cleanup=await Promise.allSettled(databases.map(async d=>{const key=`hotdata-cleanup-${d.receipt.role}`,task=`Remove the ${d.receipt.role} database`;progress(key,task,'running');try{try{await api('DELETE',`/v1/databases/${d.id}`);}catch(error){if(!(error instanceof HotdataError)||error.status!==404)throw error;}d.receipt.destroyed=true;progress(key,task,'complete','Scoped database removal confirmed.');}catch(error){progress(key,task,'error','Database cleanup is not confirmed.');throw error;}}));
    if(cleanup.some(x=>x.status==='rejected')){receipt.failure=(receipt.failure?receipt.failure+' ':'')+'A scoped database cleanup is unconfirmed; its configured 30-minute expiry is a best-effort fallback, not confirmed deletion.';if(!failure)failure=new Error(receipt.failure);}
    receipt.finishedAt=new Date().toISOString();await writeFile(`${directory}/${id}.json`,JSON.stringify(receipt,null,2),{mode:0o600});
  }
  if(failure)throw new Error(`${receipt.failure} Run ${id}.`);
  const inventory=completed[0][0],policy=completed[2][0];
  const verifiedCompany={...company,stock:{available:Number(inventory.available),unitCents:Number(inventory.unitCents),rushUnitCents:Number(inventory.rushUnitCents)},shipping:completed[1] as unknown as CompanyData['shipping'],deadline:String(policy.deadline)};
  const verifiedNotes=JSON.parse(String(policy.notesJson));if(!Array.isArray(verifiedNotes)||verifiedNotes.some(n=>typeof n!=='string')||JSON.stringify(verifiedNotes)!==JSON.stringify(notes))throw new Error('Hotdata returned inconsistent company instructions.');
  validateCompany(verifiedCompany);
  await writeFile(`${root}/verified-data.json`,JSON.stringify({company:verifiedCompany,notes:verifiedNotes,notesHash,sha256,queriedAt:receipt.finishedAt,receiptId:receipt.id}),{mode:0o600});
  return {company:verifiedCompany,notes:verifiedNotes as string[],receipt};
}
export {rows as hotdataRows};

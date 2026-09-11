import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {CompanyData} from './company-workspace.ts';
import type {ConversationState} from './conversation-model.ts';
import type {SampleProposal} from './rehearsal-model.ts';
const SOURCE=process.env.TRU_SOURCE??process.cwd();
const ROOT=`${process.env.TRU_PLAN_OUTPUT??`${process.cwd()}/run`}/conversation/procedures`;
const run=promisify(execFile);
export async function graphConstraints(company:CompanyData,notes:string[]){
 return new Promise<{engine:string;orderNode:string;rows:{kind:string;value:string}[];ms:number}>((resolve,reject)=>{
  const p=spawn(process.env.TRU_PYTHON??`${process.cwd()}/.venv/bin/python`,[`${SOURCE}/native/hydra_order.py`],{stdio:['pipe','pipe','pipe']});let out='',done=false;
  const timer=setTimeout(()=>{p.kill('SIGTERM');finish(new Error('The local HydraDB query timed out.'));},10000);
  function finish(error:Error){if(done)return;done=true;clearTimeout(timer);reject(error);}
  p.stdout.on('data',d=>{out+=d.toString();if(out.length>50000){p.kill('SIGTERM');finish(new Error('HydraDB returned too much data.'));}});p.stderr.resume();
  p.on('error',()=>finish(new Error('The local HydraDB bridge is unavailable.')));
  p.on('close',code=>{if(done)return;if(code!==0){finish(new Error('HydraDB did not confirm the order constraints.'));return;}try{const value=JSON.parse(out);done=true;clearTimeout(timer);resolve(value);}catch{finish(new Error('HydraDB returned an invalid constraint result.'));}});
  p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify({id:randomUUID(),company,notes}));
 });
}
async function play(name:'order-review'|'work-packet',input:unknown,params:Record<string,string>={}){
 const id=randomUUID(),directory=`${ROOT}/${id}`;await mkdir(directory,{recursive:true});
 const inFile=`${directory}/input.json`,outFile=`${directory}/output.${name==='order-review'?'json':'md'}`;await writeFile(inFile,JSON.stringify(input),{mode:0o600});
 const started=Date.now();const result=await run(process.env.TRU_ROTE??'rote',['play','run',`${SOURCE}/plays/${name}/main.ts`,`procedure=${SOURCE}/procedures/${name}.ts`,`input=${inFile}`,`output=${outFile}`,...Object.entries(params).map(([k,v])=>`${k}=${v}`)],{cwd:SOURCE,env:{...process.env,PATH:`${process.env.TRU_BUN_DIR?process.env.TRU_BUN_DIR+':':''}${process.env.PATH??''}`},timeout:15000,maxBuffer:256000});
 const text=await readFile(outFile,'utf8');const receipt={id,engine:'Rote 0.82.0',play:name,runId:result.stdout.match(/run_id:\s+(\S+)/)?.[1]??null,ms:Date.now()-started,cloudModelCalls:0};
 await writeFile(`${directory}/receipt.json`,JSON.stringify(receipt,null,2),{mode:0o600});
 return {text,receipt};
}
export async function reviewProcedure(company:CompanyData,notes:string[],quantity:number,budgetCents:number){const result=await play('order-review',{company,notes},{quantity:String(quantity),budgetCents:String(budgetCents)});return {...result,proposal:(JSON.parse(result.text) as {proposal:SampleProposal}).proposal};}
export async function packetProcedure(state:ConversationState){return play('work-packet',state);}

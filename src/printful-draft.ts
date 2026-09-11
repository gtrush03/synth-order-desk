import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
export interface PrintfulDraftReceipt {id:number;status:'draft';itemCount:number;externalId:string;requestSha256:string;createdAt:string;reused:boolean;submitted:false;printReady:false;artworkPending:true;catalogVariantId:4017;quantity:1;artworkSha256:string;artworkReadbackConfirmed:false;description:string;verifiedAt?:string}
type DraftConfig={recipient:Record<string,string>;catalogVariantId?:number|null;authorizedSampleQuantity?:number};
export type PrintfulDraftDependencies={fetch?:typeof fetch;token?:()=>Promise<string>;config?:()=>Promise<DraftConfig>};
const API='https://api.printful.com/v2/orders',STORE='18739084';
const ARTWORK='https://raw.githubusercontent.com/gtrush03/trusynth/master/brand/tru@16x.png';
const ARTWORK_SHA='cc163dd95ac1cca42edb957b89d0acca39c03c54caf99115aa514487b744d183';
async function readJson(path:string):Promise<any>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('Printful private receipt could not be read; inspect it before retrying.');}}
async function save(path:string,value:unknown){const staging=`${path}.${randomUUID()}.pending`;await writeFile(staging,JSON.stringify(value,null,2),{mode:0o600});await rename(staging,path);}
async function actualToken(){const contents=await readFile(join(homedir(),'.config/synthos/printful-fulfillment.env'),'utf8');const match=contents.match(/^(?:export\s+)?PRINTFUL_TOKEN=(.*)$/m);const token=match?.[1]?.trim().replace(/^(['"])(.*)\1$/,'$2');if(!token)throw Error('Printful credentials are unavailable.');return token;}
/** Saves one configured Black/M sample draft; no processing/price/fulfillment claim and no confirmation endpoint. ROOT calls only after explicit UI approval. */
export async function createPrintfulDraft(root:string,deps:PrintfulDraftDependencies={}):Promise<PrintfulDraftReceipt>{
 const dir=join(root,'printful');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const receiptPath=join(dir,'receipt.json'),attemptPath=join(dir,'attempt.json');
 const old=await readJson(receiptPath);if(old){if(old.status!=='draft'||!Number.isSafeInteger(old.id)||old.submitted!==false)throw Error('The prior Printful draft receipt needs inspection.');}
 const config=deps.config?await deps.config():await readJson(join(dir,'recipient.json')) as DraftConfig;
 if(!config?.recipient)throw Error('An approved private Printful recipient is required.');
 const recipient:Record<string,string>={};for(const k of ['name','address1','city','state_code','country_code','zip']){const v=config.recipient[k];if(typeof v!=='string'||!v.trim()||v.length>200)throw Error('The approved Printful recipient is incomplete.');recipient[k]=v.trim();}
 if(recipient.country_code!=='US')throw Error('This draft is authorized for the approved US recipient only.');
 const token=await(deps.token??actualToken)();const request=deps.fetch??fetch;
 async function call(url:string,method:'GET'|'POST',body?:string){let response:Response;try{response=await request(url,{method,redirect:'error',headers:{Authorization:`Bearer ${token}`,'X-PF-Store-Id':STORE,'Content-Type':'application/json'},...(body?{body}:{}),signal:AbortSignal.timeout(20000)});}catch{throw Error('Printful request outcome is uncertain. The attempt is retained; do not create another order.');}let json:any;try{json=await response.json();}catch{throw Error('Printful returned an unreadable response; inspect the retained attempt.');}if(!response.ok){await save(join(dir,'provider-error.json'),{at:new Date().toISOString(),status:response.status,method,response:json});throw Error(`Printful returned HTTP ${response.status}; inspect the retained attempt before retrying.`);}return json;}
 if(old){const checked=await call(`${API}/${old.id}`,'GET');await save(join(dir,'provider-readback.json'),checked);const data=checked?.data;if(data?.id!==old.id||data?.status!=='draft'||data?.external_id!==old.externalId||data?.order_items?.length!==1||data.order_items[0].catalog_variant_id!==4017||data.order_items[0].quantity!==1)throw Error('The saved Printful draft changed; inspect it before continuing.');return {...old,reused:true,verifiedAt:new Date().toISOString()};}
 let attempt=await readJson(attemptPath);
 if(!attempt){
  const externalId=`synth-${randomUUID().replace(/-/g,'').slice(0,24)}`;
  // Official catalog4017 and this exact public4896x1920 artwork were verified before handoff.
  const item={source:'catalog',catalog_variant_id:4017,quantity:1,name:'TRU Synth sample tee — Black / M',placements:[{placement:'front',technique:'dtg',print_area_type:'simple',layers:[{type:'file',url:ARTWORK,position:{width:10,height:10*1920/4896,top:2,left:1}}]}]};
  const body=JSON.stringify({external_id:externalId,recipient,order_items:[item]});
  attempt={externalId,requestSha256:createHash('sha256').update(body).digest('hex'),createdAt:new Date().toISOString(),state:'submitting',itemCount:1,catalogVariantId:4017,quantity:1,artworkSha256:ARTWORK_SHA};
  try{await writeFile(attemptPath,JSON.stringify(attempt,null,2),{flag:'wx',mode:0o600});}catch{throw Error('Another Printful attempt already exists; no duplicate POST.');}
  const created=await call(API,'POST',body);await save(join(dir,'provider-create.json'),created);
  const id=created?.data?.id;if(!Number.isSafeInteger(id)||id<=0)throw Error('Printful did not return an order ID; do not repeat creation.');
  attempt={...attempt,id,state:'created-readback-pending'};await save(attemptPath,attempt);
 }
 if(!Number.isSafeInteger(attempt.id)||attempt.id<=0)throw Error('A prior Printful POST is unresolved. Reconcile its external ID privately; no automatic resend.');
 const checked=await call(`${API}/${attempt.id}`,'GET');await save(join(dir,'provider-readback.json'),checked);
 const data=checked?.data;if(data?.id!==attempt.id||data?.status!=='draft'||data?.external_id!==attempt.externalId||!Array.isArray(data?.order_items)||data.order_items.length!==1||data.order_items[0].catalog_variant_id!==4017||data.order_items[0].quantity!==1)throw Error('Printful draft readback does not match the saved request; no confirmation was attempted.');
 const receipt:PrintfulDraftReceipt={id:data.id,status:'draft',itemCount:1,externalId:attempt.externalId,requestSha256:attempt.requestSha256,createdAt:attempt.createdAt,reused:false,submitted:false,printReady:false,artworkPending:true,catalogVariantId:4017,quantity:1,artworkSha256:ARTWORK_SHA,artworkReadbackConfirmed:false,description:'Saved one Black / M sample tee draft with TRU Synth front artwork requested. Printful artwork processing is not yet verified. No purchase or shipment.'};
 await save(receiptPath,receipt);await save(attemptPath,{...attempt,state:'verified-draft'});return receipt;
}

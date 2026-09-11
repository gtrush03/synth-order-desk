import {CONSENT_VERSION, InputError, RESOURCE_EMAIL, sha256, validateSignup} from './domain';
export type EventDatabase = Pick<D1Database,'prepare'>;
export async function signup(db:EventDatabase,input:unknown,ip:string,now=Date.now()){
 const v=validateSignup(input), id=crypto.randomUUID(),manageToken=crypto.randomUUID()+crypto.randomUUID();
 const ipHash=await sha256(`event-2026-09-11:${ip}`);
 const result=await db.prepare(`INSERT INTO visitors (id,name,email,role,interest,directory_consent,followup_consent,consent_version,created_at,expires_at,ip_hash,manage_hash)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE
 (SELECT COUNT(*) FROM visitors WHERE ip_hash=? AND created_at>?)<5 AND
 (SELECT COUNT(*) FROM visitors WHERE created_at>?)<200 AND
 (SELECT COUNT(*) FROM visitors)<500
 ON CONFLICT(email) DO NOTHING RETURNING id`).bind(id,v.name,v.email,v.role,v.interest,+v.directoryConsent,+v.followupConsent,CONSENT_VERSION,now,now+29*86400000,ipHash,await sha256(manageToken),ipHash,now-3600000,now-86400000).first<{id:string}>();
 if(!result)throw new InputError('Signup was not saved. This address may already be registered, or the signup limit was reached. Use your existing removal link or try later.',429);
 return {id,manageToken,recordedAt:new Date(now).toISOString(),emailStatus:'held',message:'Signup saved. No email has been sent.'};
}
export async function people(db:EventDatabase,now=Date.now()){
 const rows=await db.prepare('SELECT id,name,role,interest FROM visitors WHERE directory_consent=1 AND withdrawn_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 100').bind(now).all();
 return {people:rows.results,source:'Visitor signups · self-reported profiles',emailsPublic:false};
}
export async function withdraw(db:EventDatabase,id:string,token:string,now=Date.now()){
 const row=await db.prepare('UPDATE visitors SET directory_consent=0,followup_consent=0,withdrawn_at=?,name=?,email=?,role=?,interest=? WHERE id=? AND manage_hash=? AND withdrawn_at IS NULL RETURNING id').bind(now,'Removed',`removed-${id}@invalid.example`,'','',id,await sha256(token)).first();
 if(!row)throw new InputError('Removal link is invalid or has already been used.',404);
 return {removed:true,message:'Your profile and email were removed. Follow-up permission is withdrawn.'};
}
export type Sender = (message:{from:string;to:string;subject:string;text:string;idempotencyKey:string;signal:AbortSignal})=>Promise<{accepted:true;providerId:string}>;
/** Trusted ROOT integration only. This function is NOT exposed by the public Worker. */
export async function sendReviewedResource(db:EventDatabase,sender:Sender|undefined,input:{visitorId:string;approvedPreviewHash:string;reviewedByRoot:boolean},now=Date.now()){
 if(!sender)throw new InputError('Sender is held. No email sent.',503);
 if(input.reviewedByRoot!==true)throw new InputError('Exact ROOT review is required.',403);
 const visitor=await db.prepare('SELECT email FROM visitors WHERE id=? AND followup_consent=1 AND withdrawn_at IS NULL AND expires_at>?').bind(input.visitorId,now).first<{email:string}>();
 if(!visitor)throw new InputError('No current follow-up consent.',403);
 const hash=await sha256(JSON.stringify({...RESOURCE_EMAIL,to:visitor.email}));
 if(hash!==input.approvedPreviewHash)throw new InputError('Recipient or content differs from the reviewed preview.',409);
 const id=crypto.randomUUID(), day=new Date(now).toISOString().slice(0,10);
 const reserved=await db.prepare(`INSERT INTO mail_attempts(id,visitor_id,day,preview_hash,status,created_at)
 SELECT ?,?,?,?,'reserved',? WHERE (SELECT COUNT(*) FROM mail_attempts WHERE day=?)<10
 AND EXISTS(SELECT 1 FROM visitors WHERE id=? AND followup_consent=1 AND withdrawn_at IS NULL AND expires_at>?)
 ON CONFLICT(visitor_id) DO NOTHING RETURNING id`).bind(id,input.visitorId,day,hash,now,day,input.visitorId,now).first();
 if(!reserved)throw new InputError('Daily limit, prior attempt, or withdrawn consent. Nothing sent.',429);
 // Reservation counts even on timeout: an ambiguous acceptance must never be retried automatically.
 try{
  const controller=new AbortController();
  let timer: ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Sender timed out'));},15000);});
  let receipt: {accepted:true;providerId:string};
  try{receipt=await Promise.race([sender({...RESOURCE_EMAIL,to:visitor.email,idempotencyKey:id,signal:controller.signal}),timeout]);}finally{if(timer!==undefined)clearTimeout(timer);}
  if(receipt.accepted!==true||typeof receipt.providerId!=='string'||!receipt.providerId)throw new Error('Missing acceptance receipt');
  await db.prepare("UPDATE mail_attempts SET status='accepted',provider_id=? WHERE id=?").bind(receipt.providerId,id).run();
  return {status:'accepted',providerId:receipt.providerId,delivered:false};
 }catch{
  await db.prepare("UPDATE mail_attempts SET status='uncertain' WHERE id=?").bind(id).run();
  throw new InputError('Delivery is unconfirmed. Attempt retained; do not retry automatically.',502);
 }
}

export async function cleanup(db:EventDatabase,now=Date.now()){await db.prepare('DELETE FROM visitors WHERE expires_at<=? OR withdrawn_at IS NOT NULL').bind(now).run();}

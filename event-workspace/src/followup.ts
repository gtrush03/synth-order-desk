import {RESOURCE_EMAIL,sha256} from './domain';
import {sendReviewedResource,type EventDatabase,type Sender} from './store';
export type FollowupControl = {
 RESOURCE_MAIL_ENABLED?:string;
 RESOURCE_APPROVED_HASH?:string;
 SYNTH_SENDER?:Pick<Fetcher,'fetch'>;
};
/** Only operator-owned bindings can enable this path; no request supplies control or content. */
export async function followupEnabled(env:FollowupControl){return env.RESOURCE_MAIL_ENABLED==='true'&&!!env.SYNTH_SENDER&&env.RESOURCE_APPROVED_HASH===await sha256(JSON.stringify(RESOURCE_EMAIL));}
export async function requestedFollowup(db:EventDatabase,env:FollowupControl,visitorId:string){
 if(!await followupEnabled(env))return {emailStatus:'held',message:'Signup saved. Resource email is held; nothing sent.'};
 const row=await db.prepare('SELECT email FROM visitors WHERE id=? AND followup_consent=1 AND withdrawn_at IS NULL AND expires_at>?').bind(visitorId,Date.now()).first<{email:string}>();
 if(!row)return {emailStatus:'not-requested',message:'Signup saved. No resource email requested.'};
 const sender:Sender=async m=>{
  const response=await env.SYNTH_SENDER!.fetch(new Request('https://synth-sender.internal/event-resource',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':m.idempotencyKey},body:JSON.stringify({from:m.from,to:m.to,subject:m.subject,text:m.text,contentHash:env.RESOURCE_APPROVED_HASH}),signal:m.signal}));
  if(!response.ok)throw new Error('Sender did not accept');
  const data=await response.json() as {accepted?:boolean;providerId?:string};
  if(data.accepted!==true||typeof data.providerId!=='string'||!data.providerId)throw new Error('Missing receipt');
  return {accepted:true,providerId:data.providerId};
 };
 try{const receipt=await sendReviewedResource(db,sender,{visitorId,reviewedByRoot:true,approvedPreviewHash:await sha256(JSON.stringify({...RESOURCE_EMAIL,to:row.email}))});return {emailStatus:'accepted',message:'Signup saved. The mail provider accepted your resource email; delivery is unconfirmed.',providerId:receipt.providerId};}
 catch{return {emailStatus:'unconfirmed',message:'Signup saved. Resource email is unconfirmed or held by the send limit. No automatic retry.'};}
}

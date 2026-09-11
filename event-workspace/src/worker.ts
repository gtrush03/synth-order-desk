import {followupEnabled,requestedFollowup,type FollowupControl} from './followup';
import {InputError,RESOURCE_EMAIL,readJson} from './domain';
import {cleanup,people,signup,withdraw} from './store';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export default {
 async scheduled(_event:ScheduledController,env:Env):Promise<void>{await cleanup(env.EVENT_DB);},
 async fetch(request:Request,env:Env & FollowupControl):Promise<Response>{
  const url=new URL(request.url);
  try{
   if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
   if(request.method==='GET'&&url.pathname==='/api/resources')return json({...RESOURCE_EMAIL,status:await followupEnabled(env)?'Fixed resource email · available on explicit request':'Preview only · email sending held'});
   if(request.method==='GET'&&url.pathname==='/api/status'){
    let connected=false;try{connected=!!(await env.EVENT_DB.prepare('SELECT COUNT(*) AS n FROM visitors').first());}catch{}
    return json({signup:connected&&String(env.SIGNUPS_ENABLED)==='true'?'ready':'held',people:connected?'connected':'held',mail:await followupEnabled(env)?'configured':'held',label:env.DEPLOYMENT_LABEL,from:RESOURCE_EMAIL.from});
   }
   if(request.method==='GET'&&url.pathname==='/api/people')return json(await people(env.EVENT_DB));
   if(request.method==='POST'){
    if(request.headers.get('origin')!==url.origin)throw new InputError('Open the signup form on this site.',403);
    if(url.pathname==='/api/signup'){
     if(String(env.SIGNUPS_ENABLED)!=='true')throw new InputError('Signup is not connected yet. Your details have not been saved.',503);
     const input=await readJson(request);
     const saved=await signup(env.EVENT_DB,input,request.headers.get('cf-connecting-ip')||'local');
     if((input as {followupConsent:boolean}).followupConsent)return json({...saved,...await requestedFollowup(env.EVENT_DB,env,saved.id)},201);
     return json(saved,201);
    }
    if(url.pathname==='/api/withdraw'){
     const v=await readJson(request) as Record<string,unknown>;
     if(!v||typeof v.id!=='string'||typeof v.token!=='string'||v.id.length>50||v.token.length>100)throw new InputError('Check your removal link.');
     return json(await withdraw(env.EVENT_DB,v.id,v.token));
    }
   }
   return json({error:'Not found'},404);
  }catch(error){return json({error:error instanceof InputError?error.message:'Connection unavailable. No successful operation is confirmed.'},error instanceof InputError?error.status:503);}
 }
};

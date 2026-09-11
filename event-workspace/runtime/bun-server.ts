import {Database} from 'bun:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import worker from '../src/worker';
export const STATIC_FILES=['index.html','style.css','app.js','sponsors/rocketride.svg','sponsors/hydradb.png','sponsors/rote.png','sponsors/hotdata.svg','sponsors/cognee.svg','sponsors/snyk.svg'];
export function sqliteAdapter(sqlite:Database){
 return {prepare(sql:string){let values:unknown[]=[];const statement={bind(...v:unknown[]){values=v;return statement;},async first(){return sqlite.query(sql).get(...values as [])??null;},async all(){return {results:sqlite.query(sql).all(...values as [])};},async run(){return sqlite.query(sql).run(...values as []);}};return statement;}};
}
export function createRuntime(root:string,sqlite:Database,config:{origin:string;expiresAt:string},now=()=>Date.now()){
 const expiry=Date.parse(config.expiresAt);if(!Number.isFinite(expiry)||new URL(config.origin).protocol!=='https:')throw Error('Invalid reviewed runtime config');
 const deadline=new Date(expiry).toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'});
 const notice=`Temporary Tenki preview · closes ${deadline} PDT today. Signup records are deleted when this preview closes. Not official event registration. Shared signup limit: 5 per hour. Email sending held.`;
 const headers={'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
 const env={EVENT_DB:sqliteAdapter(sqlite),SIGNUPS_ENABLED:'true',RESOURCE_MAIL_ENABLED:'false',DEPLOYMENT_LABEL:notice,ASSETS:{async fetch(request:Request){const path=new URL(request.url).pathname;const file=path==='/'?'index.html':path.slice(1);if(!['GET','HEAD'].includes(request.method)||!STATIC_FILES.includes(file))return new Response('Not found',{status:404,headers});const asset=Bun.file(resolve(root,'public',file));if(!await asset.exists())return new Response('Not found',{status:404,headers});if(file==='index.html'){let html=await asset.text();html=html.replaceAll('for up to 30 days',`until this temporary preview closes at ${deadline} PDT today`).replace('<p id="environment-status" class="note" hidden></p>',`<p id="environment-status" class="note">${notice}</p>`);return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});}return new Response(request.method==='HEAD'?null:asset,{headers:{...headers,'Content-Type':asset.type}});}}};
 return async(request:Request)=>{
  if(now()>=expiry){sqlite.exec('DELETE FROM visitors');return new Response('This temporary event preview has closed. Signup records were removed.',{status:410,headers});}
  const url=new URL(request.url);const trustedHeaders=new Headers(request.headers);
  // Tenki is not Cloudflare: never accept a visitor-controlled CF IP header. A conservative shared bucket is deliberate.
  trustedHeaders.set('cf-connecting-ip','tenki-event-shared-bucket');
  const trusted=new Request(config.origin+url.pathname+url.search,{method:request.method,headers:trustedHeaders,body:request.body,duplex:'half'} as RequestInit);
  return worker.fetch(trusted,env as unknown as Env);
 };
}
if(import.meta.main){
 const root=resolve(import.meta.dir,'..');const config=JSON.parse(readFileSync(resolve(root,'runtime-config.json'),'utf8'));
 const sqlite=new Database(resolve(root,'data/event.sqlite'));sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runtime_migrations(name TEXT PRIMARY KEY)');
 for(const name of ['0001_event.sql','0002_selftest_receipt.sql']){if(!sqlite.query('SELECT name FROM runtime_migrations WHERE name=?').get(name)){sqlite.transaction(()=>{sqlite.exec(readFileSync(resolve(root,'migrations',name),'utf8'));sqlite.query('INSERT INTO runtime_migrations(name) VALUES(?)').run(name);})();}}
 const server=Bun.serve({hostname:'0.0.0.0',port:8081,maxRequestBodySize:4096,fetch:createRuntime(root,sqlite,config)});
 setTimeout(()=>{sqlite.exec('DELETE FROM visitors');sqlite.close();server.stop(true);process.exit(0);},Math.max(0,Date.parse(config.expiresAt)-Date.now()));
 console.log(JSON.stringify({port:server.port,expiresAt:config.expiresAt,mail:'held',runtime:Bun.version}));
}

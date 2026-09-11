import {test,expect} from 'bun:test';
import {createRuntime} from '../runtime/bun-server';
import {testDatabase} from './sqlite';
test('Tenki adapter limits static files, rejects cross origin, holds mail and purges on expiry',async()=>{
 const {sqlite}=testDatabase();let now=1000;
 const run=createRuntime(new URL('..',import.meta.url).pathname,sqlite,{origin:'https://event.example',expiresAt:new Date(10000).toISOString()},()=>now);
 expect((await run(new Request('http://localhost/data/event.sqlite'))).status).toBe(404);
 expect((await run(new Request('http://localhost/api/signup',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}))).status).toBe(403);
 expect((await (await run(new Request('http://localhost/api/status'))).json()).mail).toBe('held');
 expect(await (await run(new Request('http://localhost/'))).text()).toContain('Temporary Tenki preview');
 now=10001;expect((await run(new Request('http://localhost/api/status'))).status).toBe(410);expect(sqlite.query('SELECT COUNT(*) n FROM visitors').get()).toEqual({n:0});sqlite.close();
});

test('Tenki ignores spoofed CF IPs, enforces five shared signups and purges real data at expiry',async()=>{
 const {sqlite}=testDatabase();let now=Date.now();const end=now+10000;
 const run=createRuntime(new URL('..',import.meta.url).pathname,sqlite,{origin:'https://event.example',expiresAt:new Date(end).toISOString()},()=>now);
 for(let i=0;i<6;i++){
  const response=await run(new Request('http://localhost/api/signup',{method:'POST',headers:{Origin:'https://event.example','Content-Type':'application/json','CF-Connecting-IP':`spoof-${i}`},body:JSON.stringify({name:`Synthetic local fixture ${i}`,email:`runtime${i}@example.invalid`,role:'Test',interest:'Security',storageConsent:true,directoryConsent:true,followupConsent:false,consentVersion:'event-2026-09-11-v1'})}));
  expect(response.status).toBe(i<5?201:429);
 }
 expect(sqlite.query('SELECT COUNT(*) n FROM visitors').get()).toEqual({n:5});
 now=end;expect((await run(new Request('http://localhost/api/people'))).status).toBe(410);
 expect(sqlite.query('SELECT COUNT(*) n FROM visitors').get()).toEqual({n:0});sqlite.close();
});

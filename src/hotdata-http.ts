import https from 'node:https';
export class HotdataError extends Error { constructor(public status:number, public operation:string,public detail:string=''){super(`Hotdata ${operation} returned HTTP ${status}.`);} }
/** Direct documented API. IPv4 is selected for this venue's working network path. */
export function hotdataRequest(workspace:string,method:string,path:string,body?:unknown):Promise<unknown>{
  const key=process.env.HOTDATA_API_KEY;
  if(!key)throw new Error('The existing Hotdata API credential is unavailable.');
  if(!path.startsWith('/v1/')||!/^work[a-z0-9]+$/.test(workspace))throw new Error('Invalid Hotdata request scope.');
  const encoded=body===undefined?undefined:JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const request=https.request({hostname:'api.hotdata.dev',port:443,path,method,family:4,headers:{Authorization:`Bearer ${key}`,'X-Workspace-Id':workspace,'Content-Type':'application/json',...(encoded?{'Content-Length':Buffer.byteLength(encoded)}:{})}},response=>{
      let data='';response.setEncoding('utf8');
      response.on('data',chunk=>{data+=chunk;if(Buffer.byteLength(data)>512000)request.destroy(new Error('Hotdata response exceeded the bounded size.'));});
      response.on('error',reject);
      response.on('end',()=>{clearTimeout(deadline);const status=response.statusCode??0;if(status<200||status>=300){let detail='';try{const e=JSON.parse(data);detail=String(e.message??e.detail??e.error?.message??e.error??'').replaceAll(key,'[redacted]').slice(0,500);}catch{}reject(new HotdataError(status,method+' '+path.split('?')[0],detail));return;}try{resolve(data?JSON.parse(data):null);}catch{reject(new Error('Hotdata returned an invalid response.'));}});
    });
    const deadline=setTimeout(()=>request.destroy(new Error('Hotdata request exceeded 12 seconds.')),12000);
    request.on('error',()=>{clearTimeout(deadline);reject(new Error('Hotdata connection did not complete within its bounded request.'));});
    request.end(encoded);
  });
}
export function inlineCSV(records:Record<string,unknown>[]){
  if(!records.length)throw new Error('No rows to load.');
  const keys=Object.keys(records[0]);
  if(records.some(row=>keys.some(key=>row[key]===undefined||row[key]===null)))throw new Error('Incomplete company data.');
  const quote=(v:unknown)=>'"'+String(v).replaceAll('"','""')+'"';
  return {data:[keys.map(quote).join(','),...records.map(row=>keys.map(key=>quote(row[key])).join(','))].join('\n'),columns:Object.fromEntries(keys.map(key=>[key,typeof records[0][key]==='number'?'BIGINT':'VARCHAR']))};
}

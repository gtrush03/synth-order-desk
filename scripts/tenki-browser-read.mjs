// Runs only in the dedicated Tenki VM. Fresh anonymous browser; fixed public catalog.
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
const url='https://www.printful.com/custom/mens/t-shirts';
const allowed=u=>{try{const x=new URL(u);return x.protocol==='https:'&&['www.printful.com','printful.com'].includes(x.hostname)&&x.pathname.replace(/\/$/,'')==='/custom/mens/t-shirts';}catch{return false;}};
const started=Date.now();let browser,closed=false,result;
try{
 browser=await chromium.launch({headless:false,...(process.env.TRU_TENKI_CHROMIUM?{executablePath:process.env.TRU_TENKI_CHROMIUM}:{}),env:{...process.env,DISPLAY:':99'},timeout:15000});const context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().isNavigationRequest()&&!allowed(route.request().url())?route.abort('blockedbyclient'):route.continue());
 const page=await context.newPage();const response=await page.goto(url,{waitUntil:'load',timeout:20000});
 if(response?.status()!==200||!allowed(page.url()))throw Error('The public supplier catalog did not allow this cloud-browser read.');
 await page.locator('body').waitFor({state:'visible',timeout:5000});
 await page.locator('h1').first().waitFor({state:'visible',timeout:8000}).catch(()=>{});
 const facts=await page.evaluate(()=>{if(location.protocol!=='https:'||!['www.printful.com','printful.com'].includes(location.hostname)||location.pathname.replace(/\/$/,'')!=='/custom/mens/t-shirts')return null;const clean=s=>String(s??'').replace(/\s+/g,' ').trim();return {title:clean(document.title).slice(0,200),url:location.href,headings:Array.from(document.querySelectorAll('h1,h2')).slice(0,8).map(h=>clean(h.textContent).slice(0,120)),text:clean(document.body.innerText).slice(0,1500)};});
 if(!facts||/verify you are human|checking your browser|access denied|security verification/i.test(facts.title+' '+facts.text))throw Error('The supplier returned a verification page; no catalog result claimed.');
 const shot=await page.screenshot({type:'png',timeout:5000});if(!allowed(page.url()))throw Error('The supplier navigated away during capture.');
 await mkdir('/home/tenki/synth-preview/public',{recursive:true});await writeFile('/home/tenki/synth-preview/public/supplier.png',shot);
 result={outcome:'read',url:facts.url,title:facts.title,headings:facts.headings,textExcerpt:facts.text,httpStatus:response.status(),browserVersion:browser.version(),screenshotBase64:shot.toString('base64')};
}catch{result={outcome:'error',failure:'The fixed supplier catalog could not be read in the cloud browser.'};}
finally{if(browser){await browser.close();closed=true;}result={...result,closed,ms:Date.now()-started,finishedAt:new Date().toISOString()};console.log(JSON.stringify(result));}

/** Headless, source-backed tile producer. Dedicated Linux server only. */
import {chromium} from 'playwright';
export function createBrowserProducer(base){
 let browser=null,page=null,pending=Promise.resolve(),produced=0;
 async function close(){
  const former=browser;browser=null;page=null;
  await former?.close().catch(()=>{});
 }
 async function open(){
  if(page&&!page.isClosed())return page;
  browser=await chromium.launch({headless:true});
  try{
   page=await browser.newPage({viewport:{width:256,height:256},serviceWorkers:'block'});
   await page.goto(base+'/__render/',{waitUntil:'load',timeout:15000});
   await page.waitForFunction(()=>typeof window.__renderReadyTile==='function',undefined,{timeout:15000});
   return page;
  }catch(e){await close();throw e;}
 }
 function renderTile(manifest,request){
  const task=pending.catch(()=>{}).then(async()=>{
   if(produced>=120){await close();produced=0;}
   const p=await open();
   try{
    const result=await Promise.race([
     p.evaluate(({m,r})=>window.__renderReadyTile(m,r),{m:{referenceTime:manifest.referenceTime,validTimes:manifest.validTimes},r:request}),
     new Promise((_,reject)=>setTimeout(()=>reject(new Error('source-render-deadline')),45000)),
    ]);
    produced++;
    return Buffer.from(result);
   }catch(e){await close();throw e;}
  });
  pending=task.then(()=>{},()=>{});
  return task;
 }
 return {renderTile,close};
}

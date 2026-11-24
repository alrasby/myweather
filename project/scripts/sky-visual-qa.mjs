import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root=resolve('www');
await mkdir('sky-qa',{recursive:true});
const server=createServer(async(req,res)=>{
 try {
  const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(file!==root && !file.startsWith(root+'/')){res.writeHead(403).end();return;}
  const target=file===root?resolve(root,'index.html'):file;
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
  res.setHeader('Content-Type',mime[extname(target)]||'application/octet-stream');
  res.end(await readFile(target));
 } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));

let browser;
let nightBackground;
try {
browser=await chromium.launch({headless:true,args:['--no-sandbox']});
for(const [name,code,cloud,day] of [['clear',0,3,true],['thin',0,24,true],['partly',0,55,true],['overcast',0,93,true],['night',0,55,false],['rain',61,76,true],['night-clear',0,3,false],['night-thin',0,24,false],['night-overcast',0,93,false],['night-storm',95,90,false]]){
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:'reduce'});
 const page=await ctx.newPage(); const now=Date.parse(`2026-11-23T${day?'10':'20'}:00:00Z`);
 await page.clock.setFixedTime(now);
 await page.addInitScript(({now,code,cloud,day})=>{
 const p={id:'23.59,58.38',name:'مسقط',nameEn:'Muscat',country:'عُمان',countryEn:'Oman',admin:'',lat:23.59,lon:58.38,primary:true};
 const hour={t:now,temp:28,feels:29,precip:code===61?0.5:0,pop:0,code,wind:8,gust:12,uv:4,isDay:day,pressure:1010};
 const bundle={placeId:p.id,timezone:'Asia/Muscat',offset:14400,fetchedAt:now,forecastSource:'open-meteo-best-match',current:{...hour,humidity:55,cloud,dir:120,visibility:10000},hourly:Array.from({length:48},(_,i)=>({...hour,t:now+i*3600000})),daily:Array.from({length:15},(_,i)=>({t:Date.parse('2026-11-23T08:00:00Z')+i*86400000,code,tmax:30,tmin:23,sunrise:Date.parse('2026-11-23T02:30:00Z')+i*86400000,sunset:Date.parse('2026-11-23T13:30:00Z')+i*86400000,precip:0,pop:0,uv:5,wind:8})),air:null,marine:null,marineVersion:3};
 localStorage.setItem('myweather-cache-v6',JSON.stringify({places:[p],activeId:p.id,entries:{[p.id]:{at:now,bundle}}}));
 localStorage.setItem('myweather-prefs-v2',JSON.stringify({lang:'ar',theme:'sun',refreshMin:0,alerts:false,particles:'low'}));
 },{now,code,cloud,day});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765')?r.continue():r.abort());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765');
 await page.locator('[data-sky-hero]').waitFor(); await page.evaluate(()=>document.fonts.ready);
 const expected={clear:'صافٍ',thin:'صافية غالبًا',partly:'غائم جزئيًا',overcast:'غائم',night:'غائم جزئيًا',rain:'مطر','night-clear':'صافٍ','night-thin':'صافية غالبًا','night-overcast':'غائم','night-storm':'عاصفة رعدية'};
 assert.ok((await page.locator('[data-sky-hero]').innerText()).includes(expected[name]),name+' description');
 const cloudCount=await page.locator('.sky-clouds').count();
 assert.equal(cloudCount,name==='clear'||name==='night-clear'?0:1,name+' single cloud renderer');
 if(cloudCount){
  const visible=await page.locator('.sky-clouds').evaluate(c=>{
   const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>10)count++;
   return count/(pixels.length/4);
  });
  assert.ok(visible>0.005,name+' clouds must actually draw pixels');
 }
 if(!day){
  const scene=page.locator('.sky-scene');
  assert.ok((await scene.getAttribute('class')).includes('is-night-sky'),name+' actual night');
  const background=await scene.evaluate(e=>getComputedStyle(e).backgroundImage);
  nightBackground ??= background;
  assert.equal(background,nightBackground,name+' shared night sky across weather conditions');
  const tones=[...background.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)];
  assert.ok(tones.length>=2 && tones.every(([,r,g,b])=>0.2126*Number(r)+0.7152*Number(g)+0.0722*Number(b)<75),name+' dark night sky');
  if(name==='night-overcast'||name==='night-storm'){
   const brightness=await page.locator('.sky-clouds').evaluate(c=>{
    const px=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let luminance=0,weight=0;
    for(let i=0;i<px.length;i+=4){const a=px[i+3]/255;weight+=a;luminance+=(0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2])*a;}
    return luminance/Math.max(1,weight);
   });
   assert.ok(brightness<120,name+' clouds retain a night palette');
  }
 }
 assert.equal(await page.locator('.wx-qibla-refresh + p').evaluate(e=>getComputedStyle(e).fontSize),'9px','Mecca distance is one size smaller');
 assert.deepEqual(errors,[],name+' runtime errors');
 await page.screenshot({path:`sky-qa/${name}.png`});
 console.log(JSON.stringify({name,errors,description:await page.locator('[data-sky-hero]').innerText(),canvas:await page.locator('.sky-clouds').count()}));
 await ctx.close();
}
} finally {await browser?.close();await new Promise(r=>server.close(r));}

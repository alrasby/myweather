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
browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
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
 assert.equal(await page.locator('.wx-qibla-refresh + p').evaluate(e=>getComputedStyle(e).fontSize),'12px','Mecca distance uses the requested size');
 const distance=page.locator('.wx-qibla-distance');
 assert.equal(await distance.locator('span').evaluate(e=>getComputedStyle(e).display),'block','distance label on first line');
 assert.equal(await distance.locator('bdi').evaluate(e=>getComputedStyle(e).display),'block','distance value on second line');
 assert.ok(await distance.evaluate(e=>e.children[1].getBoundingClientRect().top>e.children[0].getBoundingClientRect().top),'two distinct distance lines');
 assert.deepEqual(errors,[],name+' runtime errors');
 await page.screenshot({path:`sky-qa/${name}.png`});
 console.log(JSON.stringify({name,errors,description:await page.locator('[data-sky-hero]').innerText(),canvas:await page.locator('.sky-clouds').count()}));
 await ctx.close();
}


// Pixel-level regression: November 25 waning gibbous stays illuminated.
{
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
 const page=await ctx.newPage();
 await page.clock.setFixedTime(Date.parse('2026-11-25T14:44:00Z'));
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765')?r.continue():r.abort());
 await page.goto('http://127.0.0.1:8765');
 await page.locator('.sky-moon img').waitFor();
 const moon=page.locator('.sky-moon');
 const lit=await moon.locator('img').evaluate(async(img)=>{
   await img.decode();
   const c=document.createElement('canvas');c.width=100;c.height=100;
   const g=c.getContext('2d');g.drawImage(img,0,0,100,100);
   // Apply the actual production SVG shadow, not a duplicate phase formula.
   const svg=img.parentElement.querySelector('svg');
   if(svg){const overlay=new Image();overlay.src='data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await overlay.decode();g.drawImage(overlay,0,0,100,100);}
   const p=g.getImageData(0,0,100,100).data;let sum=0,n=0;
   for(let y=20;y<80;y++)for(let x=20;x<80;x++){const i=(y*100+x)*4;sum+=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;n++;}
   return sum/n;
 });
 assert.ok(lit>80,'near-full Moon must retain visible surface detail, measured '+lit);
 await page.screenshot({path:'sky-qa/moon-waning-gibbous.png'});
 console.log(JSON.stringify({moonWaningGibbousLuminance:lit}));
 await ctx.close();
}

// Real-time solar progression: distinct fresh contexts cannot inherit another city's orbit.
const solarPositions=new Map();
for(const [city,lat,lon,zone,rise,set] of [
 ['Muscat',23.59,58.38,'Asia/Muscat','2026-11-24T02:26:00Z','2026-11-24T13:20:00Z'],
 ['NewYork',40.71,-74.01,'America/New_York','2026-11-24T11:50:00Z','2026-11-24T21:30:00Z'],
]){
 const riseMs=Date.parse(rise),setMs=Date.parse(set);
 const positions=[];
 for(const [label,p] of [['rise',0.02],['noon',0.5],['set',0.98]]){
  const now=riseMs+(setMs-riseMs)*p;
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:'reduce'});
  const page=await ctx.newPage();await page.clock.setFixedTime(now);
  await page.addInitScript(({now,lat,lon,zone,riseMs,setMs})=>{
   const place={id:'orbit-fixture',name:'مسار السماء',nameEn:'Sky passage',country:'',admin:'',lat,lon,primary:true};
   const hour={t:now,temp:28,feels:29,code:0,precip:0,pop:0,wind:4,gust:6,uv:4,isDay:true,pressure:1010};
   const b={placeId:place.id,timezone:zone,offset:0,fetchedAt:now,forecastSource:'open-meteo-best-match',current:{...hour,humidity:50,cloud:0,dir:120,visibility:10000},hourly:Array.from({length:24},(_,i)=>({...hour,t:now+i*3600000})),daily:[{t:(riseMs+setMs)/2,code:0,tmax:30,tmin:22,sunrise:riseMs,sunset:setMs,precip:0,pop:0,uv:5,wind:4}],air:null,marine:null,marineVersion:3};
   localStorage.setItem('myweather-cache-v6',JSON.stringify({places:[place],activeId:place.id,entries:{[place.id]:{at:now,bundle:b}}}));
   localStorage.setItem('myweather-prefs-v2',JSON.stringify({lang:'ar',theme:'sun',refreshMin:0,alerts:false,particles:'low'}));
  },{now,lat,lon,zone,riseMs,setMs});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8765')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:8765');await page.locator('[data-sky-hero]').waitFor();await page.evaluate(()=>document.fonts.ready);
  const sun=page.locator('[data-body="sun"]');await sun.waitFor();
  assert.ok(Math.abs(Number(await sun.getAttribute('data-progress'))-p)<0.01,city+' actual time progress');
  assert.equal(await sun.evaluate(e=>getComputedStyle(e).opacity),'1',city+' opaque sun retains warm hue');
  assert.equal(await page.locator('.sky-orbit-trail').count(),1,city+' one shared visual orbit');
  const box=await sun.boundingBox(),hero=await page.locator('[data-sky-hero]').boundingBox();
  assert.ok(box.y+box.height<=hero.y+4,city+' solar disc avoids the temperature');
  assert.ok(box.x>=0 && box.x+box.width<=390,city+' orbit fits mobile width');
  positions.push(box.x+box.width/2);
  await page.screenshot({path:`sky-qa/orbit-${city}-${label}.png`,clip:{x:0,y:0,width:390,height:260}});
  await ctx.close();
 }
 assert.ok(positions[0]>positions[1] && positions[1]>positions[2],city+' right-to-left solar motion');
 solarPositions.set(city,positions);
}
console.log(JSON.stringify({scenario:'city-local-solar-orbits',cities:solarPositions.size}));

// Replay the reported cloudy-city -> clear-city transition with real UI input.
// Observe DOM commits as well as animation frames, including a held network response.
{
 const now=Date.parse('2026-11-24T02:15:00Z');
 const cloudy={id:'40.71,-74.01',name:'مدينة غائمة',nameEn:'Cloudy city',country:'الولايات المتحدة',countryEn:'United States',admin:'',lat:40.71,lon:-74.01,primary:true};
 const clear={id:'23.59,58.38',name:'حي العرفان',nameEn:'Hay Al Irfan',country:'عُمان',countryEn:'Oman',admin:'',lat:23.59,lon:58.38,primary:false};
 const pending={...clear,id:'23.57,58.25',name:'موقع بلا ذاكرة',lat:23.57,lon:58.25};
 const makeBundle=(place,code,cloud)=>{
  const h={t:now,temp:code===3?11:22,feels:22,precip:0,pop:0,code,wind:8,gust:12,uv:0,isDay:false,pressure:1010};
  const sunrise=Date.parse(place.lon<0?'2026-11-24T11:50:00Z':'2026-11-24T02:26:00Z');
  const sunset=Date.parse(place.lon<0?'2026-11-24T21:30:00Z':'2026-11-24T13:20:00Z');
  return {placeId:place.id,timezone:place.lon<0?'America/New_York':'Asia/Muscat',offset:place.lon<0?-18000:14400,fetchedAt:now,forecastSource:'open-meteo-best-match',current:{...h,humidity:55,cloud,dir:120,visibility:10000},hourly:Array.from({length:48},(_,i)=>({...h,t:now+i*3600000})),daily:Array.from({length:15},(_,i)=>({t:Date.parse('2026-11-24T08:00:00Z')+i*86400000,code,tmax:30,tmin:20,sunrise:sunrise+i*86400000,sunset:sunset+i*86400000,precip:0,pop:0,uv:5,wind:8})),air:null,marine:null,marineVersion:3};
 };
 const entries=Object.fromEntries([cloudy,clear].map(p=>[p.id,{at:now,bundle:makeBundle(p,p===cloudy?3:0,p===cloudy?100:0)}]));
 const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,reducedMotion:'reduce'});
 const page=await ctx.newPage();await page.clock.setFixedTime(now);
 await page.addInitScript(({cloudy,clear,pending,entries})=>{
  localStorage.setItem('myweather-cache-v6',JSON.stringify({places:[cloudy,clear,pending],activeId:cloudy.id,entries}));
  localStorage.setItem('myweather-prefs-v2',JSON.stringify({lang:'ar',theme:'sun',refreshMin:0,alerts:false,particles:'low'}));
 },{cloudy,clear,pending,entries});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let release,started,finished;
 const gate=new Promise(r=>release=r),requestStarted=new Promise(r=>started=r),requestFinished=new Promise(r=>finished=r);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:8765')return route.continue();
  if(url.hostname==='api.open-meteo.com'&&url.pathname==='/v1/forecast'){
   started();await gate;
   const b=makeBundle(pending,0,0);
   const stamp=t=>new Date(t).toISOString();
   const payload={timezone:'Asia/Muscat',utc_offset_seconds:14400,current:{time:stamp(now),temperature_2m:22,apparent_temperature:22,relative_humidity_2m:55,precipitation:0,weather_code:0,cloud_cover:0,pressure_msl:1010,wind_speed_10m:8,wind_gusts_10m:12,wind_direction_10m:120,is_day:0},hourly:{time:b.hourly.map(h=>stamp(h.t)),temperature_2m:b.hourly.map(()=>22),weather_code:b.hourly.map(()=>0),cloud_cover:b.hourly.map(()=>0)},daily:{time:b.daily.map(d=>stamp(d.t).slice(0,10)),weather_code:b.daily.map(()=>0),temperature_2m_max:b.daily.map(()=>30),temperature_2m_min:b.daily.map(()=>20),sunrise:b.daily.map(d=>stamp(d.sunrise)),sunset:b.daily.map(d=>stamp(d.sunset)),precipitation_sum:b.daily.map(()=>0),precipitation_probability_max:b.daily.map(()=>0),uv_index_max:b.daily.map(()=>5),wind_speed_10m_max:b.daily.map(()=>8)}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}).catch(()=>{});finished();return;
  }
  return route.abort();
 });
 await page.goto('http://127.0.0.1:8765');await page.locator('[data-sky-hero]').waitFor();
 assert.equal(await page.locator('.sky-clouds').count(),1,'initial cloudy city');
 await page.evaluate(()=>{
  window.__skyLeaks=[];window.__watchSky=true;
  const inspect=()=>{
   const title=document.querySelector('header')?.textContent||'';
   if((title.includes('حي العرفان')||title.includes('موقع بلا ذاكرة')) && document.querySelector('.sky-clouds'))window.__skyLeaks.push(title);
  };
  window.__skyObserver=new MutationObserver(inspect);
  window.__skyObserver.observe(document.body,{subtree:true,childList:true,attributes:true});
  const tick=()=>{inspect();if(window.__watchSky)requestAnimationFrame(tick);};requestAnimationFrame(tick);
 });
 let switches=0;
 const choose=async name=>{
  await page.getByRole('button',{name:'اختيار المدينة',exact:true}).click();
  await page.getByText(name,{exact:true}).click();
  await page.locator('header').filter({hasText:name}).waitFor();
  switches++;
 };
 // Exercise the persistent Home container as well as the city-picker path.
 const swipe=async(dx,name)=>{
  await page.locator('[data-sky-hero]').evaluate((el,dx)=>{
   const send=(type,touches,changedTouches=[])=>{
    const e=new Event(type,{bubbles:true});
    Object.defineProperty(e,'touches',{value:touches});Object.defineProperty(e,'changedTouches',{value:changedTouches});el.dispatchEvent(e);
   };
   const a={clientX:190,clientY:180},b={clientX:190+dx,clientY:180};
   send('touchstart',[a]);send('touchmove',[b]);send('touchend',[],[b]);
  },dx);
  await page.locator('header').filter({hasText:name}).waitFor();switches++;
 };
 for(let i=0;i<2;i++){
  await swipe(150,clear.name);await page.waitForFunction(()=>document.querySelector('[data-sky-hero]')?.textContent.includes('صافٍ'));
  assert.equal(await page.locator('.sky-clouds').count(),0,'swipe cannot carry previous cloud pixels');
  await swipe(-150,cloudy.name);await page.locator('.sky-clouds').waitFor();
 }
 for(let i=0;i<4;i++){
  await choose(clear.name);await page.waitForFunction(()=>document.querySelector('[data-sky-hero]')?.textContent.includes('صافٍ'));
  assert.equal(await page.locator('.sky-clouds').count(),0,'cached clear city has no ghost cloud');
  await choose(cloudy.name);await page.locator('.sky-clouds').waitFor();
 }
 await choose(pending.name);await requestStarted;
 await page.waitForFunction(()=>document.querySelector('[data-sky-hero]')?.textContent.includes('صافية غالبًا'));
 assert.equal(await page.locator('.sky-clouds').count(),0,'estimated state cannot animate guessed clouds');
 assert.equal(await page.locator('.wx-hero-atmosphere').count(),0,'estimated state cannot animate guessed precipitation');
 await page.screenshot({path:'sky-qa/transition-pending.png'});
 release();await requestFinished;
 await page.waitForFunction(()=>document.querySelector('[data-sky-hero]')?.textContent.includes('صافٍ'));
 assert.equal(await page.locator('.sky-clouds').count(),0,'real clear result replaces neutral pending sky');
 await choose(cloudy.name);await page.locator('.sky-clouds').waitFor();
 await choose(clear.name);await page.waitForFunction(()=>document.querySelector('[data-sky-hero]')?.textContent.includes('صافٍ'));
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const leaks=await page.evaluate(()=>{window.__watchSky=false;window.__skyObserver.disconnect();return window.__skyLeaks;});
 assert.deepEqual(leaks,[],'no ghost clouds at DOM commits or animation frames');
 assert.deepEqual(errors,[],'switching runtime errors');
 await page.screenshot({path:'sky-qa/transition-clear.png'});
 console.log(JSON.stringify({scenario:'rapid-city-and-delayed-forecast-transition',switches,leaks:leaks.length,errors}));
 await ctx.close();
}
} finally {await browser?.close();await new Promise(r=>server.close(r));}

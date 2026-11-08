import assert from 'node:assert/strict';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
try {
 const {proxyFetch,requestLane}=await server.ssrLoadModule('/src/weather/net.ts');
 const lane=requestLane(1);const release=await lane();const ac=new AbortController();const waiting=lane(ac.signal);ac.abort();await assert.rejects(waiting,{name:'AbortError'});release();(await lane())();
 let count=0;globalThis.fetch=async()=>{count++;return new Response('{}',{status:429,headers:{'Retry-After':'120'}});};
 await assert.rejects(proxyFetch('https://quota.example/test'),/quota/);await assert.rejects(proxyFetch('https://quota.example/test'),/quota/);assert.equal(count,1);
 const unblock=[];globalThis.fetch=url=>String(url).includes('background')?new Promise(resolve=>unblock.push(()=>resolve(new Response('{}')))):Promise.resolve(new Response('{}'));
 const bg=[proxyFetch('https://test.example/background',undefined,'background'),proxyFetch('https://test.example/background',undefined,'background')];
 await proxyFetch('https://test.example/foreground');unblock.forEach(f=>f());await Promise.all(bg);
 const api=await server.ssrLoadModule('/src/weather/api.ts');const place=api.placeFromCoords(23.588,58.383,'GPS');let urls=[];
 const stamp=Date.parse('2026-11-01T06:00:00Z')/1000;
 globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify({timezone:'America/New_York',utc_offset_seconds:-18000,current:{time:stamp,temperature_2m:21},hourly:{time:[stamp-3600,stamp],temperature_2m:[20,21]},daily:{time:[stamp-3600*6],temperature_2m_max:[25],temperature_2m_min:[17],sunrise:[stamp],sunset:[stamp+36000]}}));};
 const result=await api.loadWeather(place,{force:true});assert.equal(urls.length,1);assert.ok(urls[0].includes('timeformat=unixtime'));assert.equal(result.bundle.current.t,stamp*1000);assert.equal(result.bundle.hourly[1].t-result.bundle.hourly[0].t,3600000);assert.equal(result.bundle.daily[0].sunrise,stamp*1000);assert.equal(result.estimated,false);assert.equal(api.readCacheFile().entries[place.id].bundle.current.temp,21);
 globalThis.fetch=async()=>new Response('{}',{status:403});const cached=await api.loadWeather(place,{force:true});assert.equal(cached.stale,true);assert.equal(cached.bundle.current.temp,21);
 await assert.rejects(api.loadWeather(api.placeFromCoords(-33,151,'No cache'),{force:true}),/http 403/);
 const store=await server.ssrLoadModule('/src/weather/store.ts');store.useWeather.getState().locatePlace(place);assert.deepEqual(store.activePlace(store.useWeather.getState()),place);
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation:{getCurrentPosition(ok,err,opts){setTimeout(()=>ok({coords:{latitude:23,longitude:58,accuracy:opts.enableHighAccuracy?8:1200}}),opts.enableHighAccuracy?30:1);}}}});
 const geo=await server.ssrLoadModule('/src/weather/geo.ts');const fixes=[];const best=await geo.readBestPosition(f=>fixes.push(f));assert.equal(best.accuracy,8);assert.deepEqual(fixes.map(f=>f.accuracy),[1200,8]);await new Promise(r=>setTimeout(r,40));assert.equal(fixes.length,2);
 console.log('PASS: cancelled queue recovery; Retry-After cooldown; foreground capacity; Unix/DST timestamps; forecast independent of auxiliary endpoints; GPS cache retained; stale real data; no synthetic data on failure; exact location selection; fine GPS completion.');
} finally {await server.close();}

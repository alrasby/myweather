import assert from 'node:assert/strict';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const originalFetch=globalThis.fetch;
try {
const net=await server.ssrLoadModule('/src/weather/net.ts');
const grid=await server.ssrLoadModule('/src/weather/grid.ts');
// الوزن = عدد المواقع × ceil(المتغيرات/10)، وغير Open-Meteo = 0
assert.equal(net.requestWeight('https://api.open-meteo.com/v1/forecast?latitude=1,2,3&longitude=1,2,3&hourly=a,b'),3);
assert.equal(net.requestWeight('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1&hourly=a,b,c,d,e,f,g,h,i,j,k'),2);
assert.equal(net.requestWeight('https://example.com/x?latitude=1,2'),0);
let requests=0;
globalThis.fetch=async input=>{requests++;const url=new URL(input);const lats=url.searchParams.get('latitude').split(',').map(Number),lons=url.searchParams.get('longitude').split(',').map(Number);
assert.equal(url.searchParams.get('hourly').split(',').length,9,'Map request must stay within one Open-Meteo budget multiplier');
return new Response(JSON.stringify(lats.map((lat,i)=>({latitude:lat,longitude:lons[i],hourly:{time:['2026-11-07T12:00','2026-11-07T13:00'],temperature_2m:[30,32],precipitation:[2,6],wind_speed_10m:[36,36],wind_direction_10m:[90,90],pressure_msl:[1010,1010]}}))),{status:200});};
// أول فتح: شبكة عالمية 18×9 + منطقة 16×16 (418 موقعًا) تنجحان دون رفض
const world=await grid.fetchGrid({south:-80,north:84,west:-180,lonSpan:360,rows:9,cols:18,hours:2,full:true});
const view=await grid.fetchGrid({south:20,north:28,west:54,lonSpan:10,rows:16,cols:16,hours:2,full:false});
assert.equal(world.ok.reduce((n,v)=>n+v,0),162*2);assert.equal(view.ok.reduce((n,v)=>n+v,0),256*2);
// تجاوز ميزانية الدقيقة يُرفض بسرعة بخطأ حدّ استخدام ومهلة واضحة، لا خطأ عام
const t0=Date.now();
await assert.rejects(grid.fetchGrid({south:10,north:20,west:50,lonSpan:10,rows:10,cols:10,hours:2,full:false}),/quota/);
assert.ok(Date.now()-t0<5000);assert.equal(grid.gridFailureReason(),'quota');assert.ok(net.backgroundCooldownMs()>20000);
// رفض المزوّد الساعي يضبط مهلة طويلة
globalThis.fetch=async()=>new Response('{"error":true,"reason":"Hourly API request limit exceeded."}',{status:429});
await assert.rejects(net.proxyFetch('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1&current=a'),/quota/);
console.log('PASS: weighted location budget; world+viewport within one minute; overflow refused fast with cooldown; provider hourly 429.');
} finally {globalThis.fetch=originalFetch;await server.close();}

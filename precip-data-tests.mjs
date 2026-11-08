import assert from 'node:assert/strict';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
const {fetchGrid,clearGridCache}=await server.ssrLoadModule('/src/weather/grid.ts');
let mode='liquid';const orig=globalThis.fetch;
globalThis.fetch=async()=>new Response(JSON.stringify(Array.from({length:4},(_,i)=>({latitude:24,longitude:58,hourly:{time:['2026-11-07T13:00'],temperature_2m:[24+i],precipitation:[10],rain:mode==='liquid'?[1]:undefined,showers:mode==='liquid'?[2]:undefined,snowfall:[7],snow_depth:[.2],cloud_cover:[i*30],precipitation_probability:[100],wind_speed_10m:[20],wind_direction_10m:[0]}}))));
try{
 const req={south:23,north:25,west:57,lonSpan:2,cols:2,rows:2,hours:1,full:false};
 let g=await fetchGrid(req);assert.deepEqual([...g.rain],[3,3,3,3]);assert.deepEqual([...g.temp],[24,25,26,27]);assert.deepEqual([...g.cloud],[0,30,60,90]);assert.deepEqual([...g.snow],[7,7,7,7]);
 clearGridCache();mode='fallback';g=await fetchGrid(req);assert.deepEqual([...g.rain],[0,0,0,0]);
 console.log('PASS: liquid rain separate from snow; snapped points retain request order; cloud cover independent of precipitation probability; snow-equivalent fallback is not double-counted.');
}finally{globalThis.fetch=orig;await server.close();}

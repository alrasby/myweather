import assert from 'node:assert/strict';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
const grid=await server.ssrLoadModule('/src/weather/grid.ts');
const layers=await server.ssrLoadModule('/src/weather/layers.ts');
let requests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
 requests++;
 const url=new URL(input); const lats=url.searchParams.get('latitude').split(',').map(Number),lons=url.searchParams.get('longitude').split(',').map(Number);
 const data=lats.map((lat,i)=>({latitude:lat,longitude:lons[i],hourly:{time:['2026-11-07T12:00','2026-11-07T13:00'],temperature_2m:[30,32],precipitation:[2,6],wind_speed_10m:[36,36],wind_direction_10m:[90,90],wind_u_component_10m:[-36,-36],wind_v_component_10m:[0,0],pressure_msl:[1010,1010],cloud_cover:[90,90]}}));
 return new Response(JSON.stringify(data),{status:200});
};
try {
 const req={south:20,north:28,west:54,lonSpan:10,rows:4,cols:4,hours:2,full:false};
 const g=await grid.fetchGrid(req); const s=grid.sampleGrid(g,24,59,0.5);
 assert.equal(s.temp,31); assert.equal(s.rain,4); assert.equal(s.spd,36); assert.equal(s.dirFrom,90); assert.equal(s.dirTo,270);
 assert.equal(grid.sampleNearestRain(g,24,59,0),2);assert.equal(grid.sampleNearestRain(g,24,59,1),6);
 assert.equal(grid.sampleGrid(g,0,0,0),null);
 const cached=await grid.fetchGrid(req);assert.equal(cached,g);assert.equal(requests,1);
 const world=await grid.fetchGrid({...req,south:-80,north:84,west:-180,lonSpan:360,full:true});
 assert.deepEqual(grid.sampleGrid(world,0,179.9,0),grid.sampleGrid(world,0,-180.1,0));
 const across=await grid.fetchGrid({...req,west:175,lonSpan:20});assert.ok(grid.covers(across,{south:22,north:26,west:178,east:-170}));assert.equal(grid.sampleGrid(across,24,-175,0).temp,30);
 const ac=new AbortController();ac.abort();await assert.rejects(grid.fetchGrid({...req,cols:3,signal:ac.signal}),{name:'AbortError'});
 for (const layer of layers.LAYERS) {const lut=layers.buildLutBytes(layer);assert.equal(lut.length,1024);assert.notDeepEqual([...lut.slice(0,3)],[...lut.slice(-4,-1)]);assert.equal(layers.legendTicks(layer).length,6);}
 grid.clearGridCache();globalThis.fetch=async()=>new Response('{}',{status:403});await assert.rejects(grid.fetchGrid({...req,cols:2,rows:2}),/thin/);
 console.log('PASS: temperature interpolation, hourly rainfall, wind units/direction, out-of-bounds, cache, dateline wrapping, dateline detail coverage, abort, 3 color ramps, failed-data rejection.');
}finally{globalThis.fetch=originalFetch;await server.close();}

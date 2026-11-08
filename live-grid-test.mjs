import assert from 'node:assert/strict';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const exec=promisify(execFile),original=globalThis.fetch;
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
globalThis.fetch=async url=>{const {stdout}=await exec('curl',['-fsS','--max-time','30',String(url)],{maxBuffer:8e6});return new Response(stdout,{status:200});};
try {
 const {fetchGrid,sampleGrid}=await server.ssrLoadModule('/src/weather/grid.ts');
 const g=await fetchGrid({south:22,north:25,west:56,lonSpan:4,rows:2,cols:2,hours:3,full:false});
 const s=sampleGrid(g,23.588,58.383,0);
 assert.ok(s && Number.isFinite(s.temp) && Number.isFinite(s.spd) && s.rain>=0);assert.ok(g.ok.every(Boolean));
 console.log(JSON.stringify({result:'PASS live Open-Meteo -> grid -> sample',time:new Date(g.times[0]).toISOString(),temperature:s.temp,rain:s.rain,wind:s.spd,windDirection:s.dirFrom,cells:g.ok.length}));
}finally{globalThis.fetch=original;await server.close();}

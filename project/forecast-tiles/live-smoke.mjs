/**
 * Live end-to-end ECMWF source test. Runs on GitHub Actions ONLY.
 * Verifies Open-Meteo metadata -> .om/WASM -> Chromium raster -> HTTP PNG
 * -> immutable disk/cache reuse, without enabling the Android renderer.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {validPng} from './pngIntegrity.mjs';

const port=19347;
const temp=await mkdtemp(join(tmpdir(),'myweather-live-ecmwf-'));
const out=join(process.cwd(),'forecast-tiles','qa-raster-samples');
await mkdir(out,{recursive:true});
let serverLogs='';
const server=spawn(process.execPath,['forecast-tiles/server.mjs'],{
 cwd:process.cwd(),
 env:{...process.env,TILE_PORT:String(port),TILE_CACHE_DIR:temp},
 stdio:['ignore','pipe','pipe'],
});
const log=part=>{serverLogs=(serverLogs+part).slice(-9000);};
server.stdout.on('data',log);
server.stderr.on('data',log);
const url='http://127.0.0.1:'+port;
const fetchBounded=async(path,timeout=65000)=>{
 const res=await fetch(url+path,{signal:AbortSignal.timeout(timeout),cache:'no-store'});
 return res;
};
async function ready(){
 for(let i=0;i<45;i++){
  if(server.exitCode!==null)throw new Error('server exited '+server.exitCode);
  try{if((await fetchBounded('/v1/health',2000)).ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw new Error('tile server did not become ready');
}
async function stop(){
 if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([
  new Promise(resolve=>server.once('exit',resolve)),
  new Promise(resolve=>setTimeout(resolve,2000))
 ]);if(server.exitCode===null)server.kill('SIGKILL');}
 await rm(temp,{recursive:true,force:true});
}
try{
 await ready();
 const metadataResponse=await fetchBounded('/v1/manifest.json',25000);
 assert.equal(metadataResponse.status,200,'ECMWF live manifest unavailable');
 const manifest=await metadataResponse.json();
 assert.equal(manifest.model,'ecmwf_ifs');
 assert.ok(manifest.validTimes?.length>=2,'real valid forecast hours required');
 assert.match(manifest.runId,/^\d{8}T\d{4}Z$/);
 const hour=Math.min(3,manifest.validTimes.length-1);
 // A fixed NYC tile reduces operational ambiguity; zoom eight is a bounded regional .om read.
 const z=8,x=75,y=96;
 const layers=['cloud_cover','precipitation','snowfall_water_equivalent'];
 const sizes={};
 for(const layer of layers){
  const path='/v1/tiles/'+manifest.runId+'/'+hour+'/'+layer+'/'+z+'/'+x+'/'+y+'.png';
  const started=performance.now();
  const res=await fetchBounded(path,65000);
  assert.equal(res.status,200,'real '+layer+' raster failed with HTTP '+res.status);
  assert.match(res.headers.get('content-type')??'',/image\/png/);
  const bytes=Buffer.from(await res.arrayBuffer());
  assert.ok(validPng(bytes),'real '+layer+' raster not valid 256px PNG');
  sizes[layer]={bytes:bytes.length,coldMs:Math.round(performance.now()-started)};
  await writeFile(join(out,layer+'.png'),bytes);
 }
 const path='/v1/tiles/'+manifest.runId+'/'+hour+'/cloud_cover/'+z+'/'+x+'/'+y+'.png';
 const warmBegin=performance.now();
 const cached=await fetchBounded(path,10000);
 assert.equal(cached.status,200,'cached PNG unavailable');
 assert.ok(validPng(Buffer.from(await cached.arrayBuffer())));
 const warmMs=Math.round(performance.now()-warmBegin);
 const health=await(await fetchBounded('/v1/health',3000)).json();
 assert.ok(health.cacheHits>=1,'repeat request must hit immutable source cache');
 assert.equal(health.generated,3,'exactly three source-backed layer images');
 assert.ok(health.maxObservedActive<=2,'bounded render concurrency');
 const report={referenceTime:manifest.referenceTime,runId:manifest.runId,
  validTime:manifest.validTimes[hour],tile:{z,x,y},layers:sizes,warmMs,
  cacheHits:health.cacheHits,renderP95Ms:health.renderP95Ms,cacheP95Ms:health.cacheP95Ms,
  crossOriginIsolated:process.env.TILE_RENDER_ISOLATION!=='0'};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
 console.log('LIVE_ECMWF_TILE_QA '+JSON.stringify(report));
}catch(e){
 console.error('LIVE_ECMWF_TILE_QA_FAILED '+(e?.stack??String(e)));
 console.error('TILE_SERVER_LOGS '+serverLogs);
 process.exitCode=1;
}finally{await stop();}

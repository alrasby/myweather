/** Bounded multi-region live QA, outside Android and with NO external hosting.
 * Reads pinned real ECMWF .om via a disposable loopback Chromium gateway.
 * Offline synthetic PNG fixtures are NEVER used for live meteorological claims.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validPng} from './pngIntegrity.mjs';
import {eastWestSeam,decodeRasterPng} from './rasterParity.mjs';
import {validTile} from './contracts.mjs';

const PORT=19349;
const root=await mkdtemp(join(tmpdir(),'myweather-ecmwf-global-'));
const output=join(process.cwd(),'forecast-tiles','qa-global-source');
await mkdir(output,{recursive:true});
let logTail='';
const server=spawn(process.execPath,['forecast-tiles/server.mjs'],{
  cwd:process.cwd(),stdio:['ignore','pipe','pipe'],
  env:{...process.env,TILE_PORT:String(PORT),TILE_CACHE_DIR:root,
    TILE_CACHE_MAX_MB:'48',TILE_CACHE_MAX_ENTRIES:'600'},
});
for(const stream of [server.stdout,server.stderr])
  stream.on('data',data=>{logTail=(logTail+String(data)).slice(-9000);});
const base='http://127.0.0.1:'+PORT;
const get=(path,ms=70000)=>fetch(base+path,{signal:AbortSignal.timeout(ms),cache:'no-store'});
const digest=b=>createHash('sha256').update(b).digest('hex');
const cleanName=x=>x.replace(/[^a-z0-9_-]/gi,'_').slice(0,70);
const report={mode:'live-source-only',source:'ECMWF IFS via Open-Meteo .om',sampledAt:new Date().toISOString(),
  manifest:null,regions:[],seams:[],frames:[],cityCloudSamples:[],diskCache:null,cacheHits:0,coldP95Ms:null};
async function ready(){
  for(let i=0;i<70;i++){
    if(server.exitCode!==null)throw new Error('loopback-producer-exited-'+server.exitCode);
    try{if((await get('/v1/health',1500)).ok)return;}catch{}
    await new Promise(done=>setTimeout(done,200));
  }
  throw new Error('loopback-producer-startup-timeout');
}
async function stop(){
  if(server.exitCode===null){
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(done=>server.once('exit',done)),
      new Promise(done=>setTimeout(done,2500)),
    ]);
    if(server.exitCode===null)server.kill('SIGKILL');
  }
  await rm(root,{recursive:true,force:true});
}
/** Published geometry only; no user/device coordinates. */
function tileAt(z,lat,lon){
  const n=2**z,latitude=Math.max(-85.051,Math.min(85.051,lat))*Math.PI/180;
  return {z,x:Math.max(0,Math.min(n-1,Math.floor((lon+180)/360*n))),
    y:Math.max(0,Math.min(n-1,Math.floor((1-Math.asinh(Math.tan(latitude))/Math.PI)/2*n)))};
}
let manifest=null;
let requested=0;
const times=[];
async function tile(name,coord,layer,hour){
  const request={runId:manifest.runId,timeIndex:hour,layer,...coord};
  assert.ok(validTile(manifest,request),'source tile request must belong to pinned model');
  const path='/v1/tiles/'+request.runId+'/'+hour+'/'+layer+'/'+coord.z+'/'+coord.x+'/'+coord.y+'.png';
  const started=performance.now(),response=await get(path);
  assert.equal(response.status,200, 'real source tile '+name+' HTTP '+response.status);
  assert.match(response.headers.get('content-type')??'',/^image\/png\b/);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.ok(validPng(bytes),'invalid real source raster '+name);
  const coldMs=Math.round(performance.now()-started);
  times.push(coldMs);
  await writeFile(join(output,cleanName(name)+'.png'),bytes);
  report.regions.push({name,layer,hour,validTime:manifest.validTimes[hour],
    zoom:coord.z,bytes:bytes.length,sha256:digest(bytes),coldMs});
  requested++;
  return {bytes,path};
}
function sourceCloudPixel(image,z,lat,lon){
  const n=2**z,latitude=lat*Math.PI/180;
  const mercX=(lon+180)/360*n;
  const mercY=(1-Math.asinh(Math.tan(latitude))/Math.PI)/2*n;
  const x=Math.max(0,Math.min(255,Math.floor((mercX-Math.floor(mercX))*256)));
  const y=Math.max(0,Math.min(255,Math.floor((mercY-Math.floor(mercY))*256)));
  const rgba=decodeRasterPng(image);
  let alpha=0,cells=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const xx=Math.max(0,Math.min(255,x+dx)),yy=Math.max(0,Math.min(255,y+dy));
    alpha+=rgba[(yy*256+xx)*4+3];cells++;
  }
  return {pixel:{x,y},centerAlpha:rgba[(y*256+x)*4+3],
    mean5x5Alpha:Number((alpha/cells).toFixed(2))};
}
function assess(name,left,right){
  const seam=eastWestSeam(left.bytes,right.bytes);
  report.seams.push({name,...seam});
  assert.equal(seam.suspiciousWall,false,
    'persistent hard alpha wall in real ECMWF source tiles: '+name);
}
try{
  await ready();
  const response=await get('/v1/manifest.json',25000);
  assert.equal(response.status,200,'pinned ECMWF manifest must be available');
  manifest=await response.json();
  assert.equal(manifest.model,'ecmwf_ifs');
  assert.equal(manifest.tileSize,256);
  assert.equal(manifest.layers?.length,3);
  assert.ok(manifest.validTimes?.length>=5);
  assert.match(manifest.runId,/^\d{8}T\d{4}Z$/);
  assert.equal(manifest.runId,new Date(manifest.referenceTime).toISOString()
    .slice(0,13).replaceAll('-','').replaceAll(':','').replace('T','T')+'00Z',
    'manifest run ID must represent the same exact UTC model initialization');
  const hour=3,next=4;
  assert.ok(Date.parse(manifest.validTimes[hour])<Date.parse(manifest.validTimes[next]));
  report.manifest={runId:manifest.runId,referenceTime:manifest.referenceTime,
    validTime:manifest.validTimes[hour],nextValidTime:manifest.validTimes[next]};
  // World zoom represents the user's reported z3/z4 difficult pan, without
  // pretending a local z8 thumbnail validates continent-wide data.
  await tile('world-z3-arabian-cloud',tileAt(3,24,60),'cloud_cover',hour);
  // Same source run/time for all three physically distinct variables.
  const arabia=tileAt(7,24,58);
  for(const layer of manifest.layers)
    await tile('arabia-'+layer,arabia,layer,hour);
  await tile('arabia-next-hour-precipitation',arabia,'precipitation',next);
  // Adjacent Atlantic tiles at same run/hour test ordinary west-east seam.
  const atlantic=tileAt(6,52,-35);
  const west=await tile('atlantic-west',atlantic,'cloud_cover',hour);
  const east=await tile('atlantic-east',{...atlantic,x:atlantic.x+1},'cloud_cover',hour);
  assess('north-atlantic-z6',west,east);
  // Longitude wraps from x=2^z-1 to x=0 at ±180: no synthetic interpolation.
  const datelineY=tileAt(6,30,179).y;
  const pacificWest=await tile('dateline-179E',{z:6,x:63,y:datelineY},'cloud_cover',hour);
  const pacificEast=await tile('dateline-180W',{z:6,x:0,y:datelineY},'cloud_cover',hour);
  assess('pacific-dateline-z6',pacificWest,pacificEast);
  // Polar edge is tested independently: no fictitious data outside Mercator.
  await tile('high-latitude-70N',tileAt(6,70,20),'cloud_cover',hour);
  // For the reported London clear/cloud discrepancy, measure genuine ECMWF
  // cloud PNG ALPHA directly at the city's coordinates for matching UTC hours.
  // Alpha is a VISUAL palette channel, never meteorological cloud percent,
  // and cannot establish which independent model is observationally correct.
  const london={lat:51.5074,lon:-0.1278};
  const disputedUtcTimes=['2026-11-14T16:00:00.000Z','2026-11-15T01:00:00.000Z'];
  const sampleTimes=disputedUtcTimes.filter(t=>manifest.validTimes.includes(t));
  if(!sampleTimes.length)sampleTimes.push(manifest.validTimes[hour]);
  // The reported screenshot was at map zoom 5. A single z7 point sample
  // cannot prove what z5 actually renders, so compare BOTH native zooms.
  for(const z of [5,7]){
    const londonTile=tileAt(z,london.lat,london.lon);
    for(const validTime of sampleTimes){
      const sourceHour=manifest.validTimes.indexOf(validTime);
      const real=await tile('london-z'+z+'-cloud-'+validTime,londonTile,'cloud_cover',sourceHour);
      report.cityCloudSamples.push({city:'London, UK',zoom:z,validTime,runId:manifest.runId,
        ...sourceCloudPixel(real.bytes,londonTile.z,london.lat,london.lon),
        interpretation:'alpha-0..255-is-visual-cloud-opacity-not-cloud-percentage'});
    }
  }
  // A subsequent immutable GET must yield exactly the same PNG bytes; no
  // second render, no substitution of a later run or altered image colors.
  const warmTarget=report.regions.find(x=>x.name==='arabia-cloud_cover');
  const cachedPath='/v1/tiles/'+manifest.runId+'/'+hour+'/cloud_cover/'+arabia.z+'/'+arabia.x+'/'+arabia.y+'.png';
  const before=performance.now(),warm=await get(cachedPath,15000);
  assert.equal(warm.status,200);
  const warmData=Buffer.from(await warm.arrayBuffer());
  assert.ok(validPng(warmData));
  assert.equal(digest(warmData),warmTarget.sha256,'cached pixel content changed');
  const warmMs=Math.round(performance.now()-before);
  const health=await(await get('/v1/health',5000)).json();
  assert.equal(health.generated,requested,'unexpected duplication of source renders');
  assert.ok(health.cacheHits>=1,'immutable pinned tile must hit source cache');
  assert.ok(health.maxObservedActive<=2,'off-device rendering must remain bounded');
  assert.ok(health.diskCache.storedBytes<=48*1024*1024);
  assert.ok(health.diskCache.entries<=600);
  assert.equal(health.diskCache.evictions,0,'bounded sample should fit in QA cache');
  report.diskCache=health.diskCache;
  report.cacheHits=health.cacheHits;
  report.warmMs=warmMs;
  const ordered=[...times].sort((a,b)=>a-b);
  report.coldP95Ms=ordered[Math.ceil(ordered.length*.95)-1];
  report.renderP95Ms=health.renderP95Ms;
  console.log('ECMWF_GLOBAL_LIVE_QA '+JSON.stringify(report));
}catch(error){
  report.failure=String(error?.message??error);
  console.error('ECMWF_GLOBAL_LIVE_QA_FAILED',error?.stack??error);
  console.error('ECMWF_SOURCE_SERVER_TAIL',logTail);
  process.exitCode=1;
}finally{
  await writeFile(join(output,'global-report.json'),JSON.stringify(report,null,2));
  await stop();
}

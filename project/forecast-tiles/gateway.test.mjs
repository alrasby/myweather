import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTileGateway} from './gateway.mjs';
import {makeTestPng} from './testPng.mjs';
import {parseModelMetadata,tilePath,tileBounds,pinnedTileUrl} from './contracts.mjs';
const t='2026-11-13T00:00:00.000Z';
const meta={reference_time:t,valid_times:[t,'2026-11-13T01:00:00.000Z'],variables:['cloud_cover','precipitation','snowfall_water_equivalent'],completed:true};
const png=makeTestPng();
const r={runId:'20261113T0000Z',timeIndex:1,layer:'precipitation',z:2,x:3,y:1};
test('pinned real model run, UTC, bounds, 3 meteorological variables and tile validation',()=>{
 const m=parseModelMetadata(meta);
 assert.equal(m.runId,r.runId);
 assert.equal(tilePath(m,r),'20261113T0000Z/1/precipitation/2/3/1.png');
 assert.ok(pinnedTileUrl(m,r).includes('precipitation'));
 assert.ok(tileBounds(r).south<tileBounds(r).north);
 assert.throws(()=>tilePath(m,{...r,layer:'../secret'}));
 assert.throws(()=>tilePath(m,{...r,x:4}));
 assert.throws(()=>parseModelMetadata({...meta,variables:['cloud_cover']}));
 assert.throws(()=>parseModelMetadata({...meta,valid_times:[t,t]}));
});
test('singleflight identical real tile, disk cache and reject wrong forecast run',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mw-tiles-'));
 let renders=0;
 const api=createTileGateway({cacheDir:dir,fetchMetadata:async()=>meta,renderTile:async()=>{renders++;await new Promise(q=>setTimeout(q,20));return png;}});
 api.server.listen(0,'127.0.0.1');await new Promise(q=>api.server.once('listening',q));
 const base='http://127.0.0.1:'+api.server.address().port;
 try{
  const manifest=await(await fetch(base+'/v1/manifest.json')).json();
  const url=base+'/v1/tiles/'+tilePath(manifest,r);
  const responses=await Promise.all(Array.from({length:5},()=>fetch(url)));
  assert.deepEqual(responses.map(x=>x.status),[200,200,200,200,200]);
  assert.equal(renders,1);
  assert.deepEqual(await readFile(join(dir,tilePath(manifest,r))),png);
  assert.equal((await fetch(url)).headers.get('cache-control'),'public, max-age=31536000, immutable');
  assert.equal(renders,1);
  assert.equal((await fetch(url.replace(r.runId,'20261112T0000Z'))).status,404);
 }finally{await new Promise(q=>api.server.close(q));await rm(dir,{recursive:true,force:true});}
});
test('never cache false or corrupted weather images',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mw-invalid-'));
 const api=createTileGateway({cacheDir:dir,fetchMetadata:async()=>meta,renderTile:async()=>Buffer.from('fake forecast')});
 api.server.listen(0,'127.0.0.1');await new Promise(q=>api.server.once('listening',q));
 try{const url='http://127.0.0.1:'+api.server.address().port+'/v1/tiles/20261113T0000Z/1/cloud_cover/2/1/1.png';assert.equal((await fetch(url)).status,502);}
 finally{await new Promise(q=>api.server.close(q));await rm(dir,{recursive:true,force:true});}
});

test("one active rendering slot is never oversubscribed when queued clients resume",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mw-tiles-queue-"));
 let active=0,peak=0;
 const api=createTileGateway({cacheDir:dir,fetchMetadata:async()=>meta,maxActive:1,maxWaiting:2,
  renderTile:async()=>{active++;peak=Math.max(peak,active);
   await new Promise(done=>setTimeout(done,15));active--;return png;}});
 api.server.listen(0,"127.0.0.1");await new Promise(done=>api.server.once("listening",done));
 try{
  const base="http://127.0.0.1:"+api.server.address().port;
  const urls=[0,1,2].map(x=>base+"/v1/tiles/20261113T0000Z/1/cloud_cover/2/"+x+"/1.png");
  const responses=await Promise.all(urls.map(url=>fetch(url)));
  assert.deepEqual(responses.map(r=>r.status),[200,200,200]);
  assert.equal(peak,1);
  const snapshot=await(await fetch(base+"/v1/health")).json();
  assert.equal(snapshot.maxObservedActive,1);
  assert.ok(snapshot.renderP95Ms>=10);
 }finally{await new Promise(done=>api.server.close(done));await rm(dir,{recursive:true,force:true});}
});

test('source UTC minute/second precision is normalized and valid horizon may exceed 256 entries',()=>{
 const m=parseModelMetadata({...meta,reference_time:'2026-11-13T00:00Z',valid_times:[
  '2026-11-13T00:00Z','2026-11-13T01:00+00:00','2026-11-13T02:00:00.000Z',
  ...Array.from({length:360},(_,i)=>new Date(Date.parse('2026-11-13T03:00:00Z')+i*3600000).toISOString()),
 ]});
 assert.equal(m.runId,'20261113T0000Z');
 assert.equal(m.validTimes.length,96);
 assert.equal(m.validTimes[0],'2026-11-13T00:00:00.000Z');
 assert.equal(m.validTimes[1],'2026-11-13T01:00:00.000Z');
 assert.throws(()=>parseModelMetadata({...meta,valid_times:['2026-11-13T01:00Z','2026-11-13T00:00Z']}),/model-time-invalid/);
 assert.throws(()=>parseModelMetadata({...meta,valid_times:['2026-11-13T00:00+04:00']}),/model-time-invalid/);
});

test("pinned old ECMWF run remains coherent during a model rollover and expires on schedule",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mw-tiles-rolling-"));
 let t=1000,next=false,generated=0;
 const newer={...meta,reference_time:"2026-11-13T06:00:00Z",
  valid_times:["2026-11-13T06:00:00Z","2026-11-13T07:00:00Z"]};
 const api=createTileGateway({cacheDir:dir,manifestTtlMs:50,retiredRunMs:120000,now:()=>t,
  fetchMetadata:async()=>next?newer:meta,renderTile:async()=>{generated++;return png;}});
 api.server.listen(0,"127.0.0.1");await new Promise(done=>api.server.once("listening",done));
 const base="http://127.0.0.1:"+api.server.address().port;
 try{
  assert.equal((await(await fetch(base+"/v1/manifest.json")).json()).runId,r.runId);
  const oldUrl=base+"/v1/tiles/"+tilePath(parseModelMetadata(meta),r);
  assert.equal((await fetch(oldUrl)).status,200);
  t+=60;next=true;
  assert.equal((await(await fetch(base+"/v1/manifest.json")).json()).runId,"20261113T0600Z");
  assert.equal((await fetch(oldUrl)).status,200,"old pinned run remains addressable after rollover");
  assert.equal(generated,1,"old completed image is reused, not regenerated");
  t+=120001;
  assert.equal((await fetch(oldUrl)).status,404,"expired pinned run cannot silently appear as a newer hour");
 }finally{await new Promise(done=>api.server.close(done));await rm(dir,{recursive:true,force:true});}
});
test("a short source outage reuses only verified metadata and eventually fails closed",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mw-tiles-stale-"));
 let t=2000,outage=false;
 const api=createTileGateway({cacheDir:dir,manifestTtlMs:10,staleManifestMs:500,now:()=>t,
  fetchMetadata:async()=>{if(outage)throw new Error("unavailable");return meta;},
  renderTile:async()=>png});
 api.server.listen(0,"127.0.0.1");await new Promise(done=>api.server.once("listening",done));
 const base="http://127.0.0.1:"+api.server.address().port;
 try{
  assert.equal((await fetch(base+"/v1/manifest.json")).status,200);
  t+=20;outage=true;
  assert.equal((await fetch(base+"/v1/manifest.json")).status,200);
  t+=600;
  assert.equal((await fetch(base+"/v1/manifest.json")).status,503);
 }finally{await new Promise(done=>api.server.close(done));await rm(dir,{recursive:true,force:true});}
});

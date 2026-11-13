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

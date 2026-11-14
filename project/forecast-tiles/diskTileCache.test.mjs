import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {createDiskTileCache} from './diskTileCache.mjs';
import {makeTestPng} from './testPng.mjs';
const png=makeTestPng();
const keys=[0,1,2].map(x=>'20261114T0600Z/3/cloud_cover/3/'+x+'/1.png');
test('finite disk quota evicts least recently used real images, never cache fabrications',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mw-offdevice-bounded-'));
 try{
  const cache=createDiskTileCache({root:dir,maxBytes:png.length*2,maxEntries:2});
  await cache.write(keys[0],png);
  await cache.write(keys[1],png);
  assert.deepEqual(await cache.read(keys[0]),png); // update access-order LRU
  await cache.write(keys[2],png);
  assert.equal(cache.snapshot().entries,2);
  assert.equal(cache.snapshot().storedBytes,png.length*2);
  assert.equal(cache.snapshot().evictions,1);
  assert.equal(await cache.read(keys[1]),null);
  assert.deepEqual(await cache.read(keys[0]),png);
  assert.deepEqual(await cache.read(keys[2]),png);
  await assert.rejects(()=>cache.write('../outside.png',png),/invalid-disk-tile-path/);
  await assert.rejects(()=>cache.write(keys[1],Buffer.from('not a PNG')),/invalid-source-raster/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('restart rescans valid tile tree and safely bounds earlier disk files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mw-offdevice-restart-'));
 try{
  for(const key of keys){const path=join(dir,...key.split('/'));await mkdir(dirname(path),{recursive:true});await writeFile(path,png);}
  const restarted=createDiskTileCache({root:dir,maxBytes:png.length*2,maxEntries:2});
  assert.deepEqual(await restarted.read(keys[2]),png);
  assert.equal(restarted.snapshot().entries,2);
  assert.equal(restarted.snapshot().storedBytes,png.length*2);
  assert.equal(restarted.snapshot().evictions,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent completed renders cannot oversubscribe the disk budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mw-offdevice-races-'));
 try{
  const cache=createDiskTileCache({root:dir,maxBytes:png.length*2,maxEntries:2});
  await Promise.all(keys.map(key=>cache.write(key,png)));
  assert.equal(cache.snapshot().entries,2);
  assert.ok(cache.snapshot().storedBytes<=png.length*2);
  const bad=join(dir,...keys[0].split('/'));await mkdir(dirname(bad),{recursive:true});await writeFile(bad,Buffer.from('corrupt'));
  assert.equal(await cache.read(keys[0]),null);
  assert.ok(cache.snapshot().storedBytes<=png.length*2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

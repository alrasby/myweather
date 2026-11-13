import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseReadyManifest,readyTileUrl,ReadyTileClient,readyTilesBase} from './readyTileClient.ts';
const manifest={schemaVersion:1 as const,model:'ecmwf_ifs' as const,runId:'20261113T0000Z',referenceTime:'2026-11-13T00:00:00.000Z',validTimes:['2026-11-13T00:00:00.000Z','2026-11-13T01:00:00.000Z'],layers:['cloud_cover','precipitation','snowfall_water_equivalent'] as const,tileSize:256 as const,maxNativeZoom:8};
class FakeLayer{
 events=new globalThis.Map<string,Array<()=>void>>();opacity=0;url:string;opts:Record<string,unknown>;map:FakeMap|null=null;style={transition:''};
 constructor(url:string,opts:Record<string,unknown>){this.url=url;this.opts=opts;}
 on(name:string,fn:()=>void){this.events.set(name,[...(this.events.get(name)??[]),fn]);return this;}
 addTo(map:FakeMap){this.map=map;map.layers.add(this);return this;}
 remove(){this.map?.layers.delete(this);this.map=null;}
 setOpacity(n:number){this.opacity=n;return this;}
 getContainer(){return {style:this.style};}
 fire(name:string){for(const fn of this.events.get(name)??[])fn();}
}
class FakeMap{layers=new Set<FakeLayer>();getCenter(){return {lat:23,lng:58};}getZoom(){return 5;}}
class FakeLeaflet{tiles:FakeLayer[]=[];tileLayer(url:string,options:Record<string,unknown>){const t=new FakeLayer(url,options);this.tiles.push(t);return t;}}
function make(){
 const L=new FakeLeaflet(),map=new FakeMap(),published:string[]=[],images:string[]=[];
 const client=new ReadyTileClient(L as never,map as never,'https://tiles.example.org',manifest,
   t=>published.push(t),()=>published.push('missing'),url=>{images.push(url);return {src:url} as HTMLImageElement;});
 return {L,map,published,images,client};
}
function loaded(tiles:FakeLayer[]){for(const tile of tiles){tile.fire('tileload');tile.fire('load');}}
test('strict source manifest, run and safe tile URLs',()=>{
 assert.equal(parseReadyManifest(manifest).runId,manifest.runId);
 assert.equal(readyTileUrl('https://tiles.example.org',manifest,{hour:1,layer:'cloud_cover',z:3,x:2,y:3}),'https://tiles.example.org/v1/tiles/20261113T0000Z/1/cloud_cover/3/2/3.png');
 assert.throws(()=>readyTileUrl('https://tiles.example.org',manifest,{hour:3,layer:'cloud_cover',z:3,x:2,y:3}));
 assert.throws(()=>readyTilesBase('http://untrusted.example.org'));
 assert.throws(()=>parseReadyManifest({...manifest,validTimes:[manifest.validTimes[1],manifest.validTimes[0]]}));
 assert.throws(()=>parseReadyManifest({...manifest,runId:'20261112T0000Z'}));
});
test('complete three-layer source frame publishes atomically and switches UTC hour',async()=>{
 const {L,map,published,client}=make();
 try{
  client.show(0);assert.equal(L.tiles.length,3);assert.equal(map.layers.size,3);
  loaded(L.tiles.slice(0,2));assert.equal(client.displayedTime,null);
  loaded(L.tiles.slice(2,3));assert.equal(client.displayedHour,0);
  assert.ok(L.tiles.slice(0,3).every(tile=>tile.opacity===1));
  assert.deepEqual(published,[manifest.validTimes[0]]);
  client.show(1);assert.equal(L.tiles.length,6);assert.equal(client.displayedHour,0);
  loaded(L.tiles.slice(3,6));assert.equal(client.displayedHour,1);
  assert.ok(L.tiles.slice(3,6).every(tile=>tile.opacity===0),'new authentic hour starts transparent for GPU fade');
  await new Promise(done=>setTimeout(done,35));
  assert.ok(L.tiles.slice(3,6).every(tile=>tile.opacity===1),'new hour becomes visible');
  assert.ok(L.tiles.slice(0,3).every(tile=>tile.opacity===0),'old hour fades away');
  assert.deepEqual(published,[manifest.validTimes[0],manifest.validTimes[1]]);
 }finally{client.destroy();assert.equal(map.layers.size,0);}
});
test('failed or obsolete frame never publishes invented or partial weather',()=>{
 const {L,published,client,images}=make();
 try{
  client.show(0);loaded(L.tiles.slice(0,3));
  client.show(1);L.tiles[3]!.fire('tileerror');
  loaded(L.tiles.slice(3,6));assert.equal(client.displayedHour,0);
  client.prefetch(0,1,0,true,false);assert.ok(images.length>0&&images.length<=8);
  const before=images.length;client.prefetch(0,1,0,true,false);
  assert.equal(images.length,before,"repeat viewport must reuse already started real tile fetches");
  client.prefetch(0,1,0,true,true);assert.equal(client.displayedHour,0);
  assert.equal(published.length,1);
 }finally{client.destroy();}
});

test('a later current-viewport tile error removes stale ECMWF imagery and enters cooldown',()=>{
 const {L,map,published,client}=make();
 try{
  client.show(0);loaded(L.tiles.slice(0,3));
  L.tiles[0]!.fire('tileerror');
  assert.equal(client.displayedTime,null);
  assert.equal(map.layers.size,0);
  assert.deepEqual(published,[manifest.validTimes[0],'missing']);
  client.show(0);assert.equal(L.tiles.length,3,'cooldown must not hot-loop failed source');
 }finally{client.destroy();}
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {softenSpatialTileArrival,canHoldCertifiedSpatialViewport,SPATIAL_VIEWPORT_HOLD_MAX_MS, type SpatialTileNode} from "./spatialTileReveal.ts";
test("soften only visible real ECMWF tiles with bounded compositor opacity",()=>{
 let calls=0;
 let duration=0;
 const tile={style:{visibility:"visible"},animate:(frames:unknown,opts:unknown)=>{
   calls++;
   duration=(opts as {duration:number}).duration;
   assert.deepEqual(frames,[{opacity:0.68},{opacity:1}]);
   return {} as Animation;
 }} as SpatialTileNode;
 assert.equal(softenSpatialTileArrival(tile,true),true);
 assert.equal(duration,160);
 assert.equal(softenSpatialTileArrival(tile,true,true),false);
 assert.equal(softenSpatialTileArrival(tile,false),false);
 tile.style.visibility="hidden";
 assert.equal(softenSpatialTileArrival(tile,true),false);
 assert.equal(calls,1);
 assert.equal(softenSpatialTileArrival({style:{visibility:"visible"}},true),false);
});

test("same-zoom overlap retains a certified real ECMWF layer while edge tiles load",()=>{
 const previous={west:0,east:20,south:40,north:60,zoom:5};
 const near={west:2,east:22,south:41,north:61,zoom:5};
 const now=20000;
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,1,now-100,now),true);
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,.15,now-7000,now),true);
});
test("no stale continents, different zoom, missing previous coverage or infinite visual hold",()=>{
 const previous={west:0,east:20,south:40,north:60,zoom:5};
 const now=20000;
 const far={west:100,east:120,south:-10,north:10,zoom:5};
 const zoom={west:2,east:22,south:41,north:61,zoom:6};
 const near={west:2,east:22,south:41,north:61,zoom:5};
 assert.equal(canHoldCertifiedSpatialViewport(previous,far,1,now-100,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,zoom,1,now-100,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(null,near,1,now-100,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,0,now-100,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,1,now-SPATIAL_VIEWPORT_HOLD_MAX_MS,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,1,now+1,now),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,near,1,0,now),false);
});

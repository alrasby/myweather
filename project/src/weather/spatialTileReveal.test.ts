import assert from "node:assert/strict";
import {test} from "node:test";
import {softenSpatialTileArrival,canHoldCertifiedSpatialViewport,spatialViewportOverlap,canStageSpatialRefresh,SPATIAL_VIEWPORT_HOLD_MAX_MS, type SpatialTileNode} from "./spatialTileReveal.ts";
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

test("moderate authentic same-zoom overlap retains visible ECMWF pixels rather than flashing to zero",()=>{
 const previous={west:0,east:40,south:30,north:70,zoom:3};
 const partial={west:18,east:58,south:44,north:84,zoom:3};
 const overlap=spatialViewportOverlap(previous,partial);
 assert.ok(overlap);
 assert.ok(overlap.longitude>0.5&&overlap.latitude>0.6);
 assert.equal(canStageSpatialRefresh(previous,partial),false,
   "moderate moves must NOT hide newly decoded source tiles awaiting a full batch");
 assert.equal(canHoldCertifiedSpatialViewport(previous,partial,1,19000,20000),true,
   "old, geographically aligned tiles should remain visible while genuine new ones load");
});
test("never hold an old continent over a different geography or a different grid zoom",()=>{
 const previous={west:-30,east:30,south:20,north:80,zoom:3};
 const next={west:92,east:152,south:20,north:80,zoom:3};
 const disjoint={west:40,east:100,south:20,north:80,zoom:3};
 assert.equal(canHoldCertifiedSpatialViewport(previous,next,1,19900,20000),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,disjoint,1,19900,20000),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,{...previous,zoom:4},1,19900,20000),false);
 assert.equal(canHoldCertifiedSpatialViewport(previous,{...previous,south:76,north:136},1,19900,20000),false);
});
test("wrapped world geography keeps the identical source tile across the date line",()=>{
 const prior={west:169,east:189,south:-5,north:15,zoom:3};
 const later={west:-189,east:-169,south:-4,north:16,zoom:3};
 const overlap=spatialViewportOverlap(prior,later);
 assert.ok(overlap&&overlap.longitude>=0.9&&overlap.latitude>=0.9);
 assert.equal(canHoldCertifiedSpatialViewport(prior,later,1,19900,20000),true);
});
test("refresh holding expires and never turns an unseen source into forecast coverage",()=>{
 const prior={west:0,east:50,south:20,north:70,zoom:3};
 const next={west:15,east:65,south:30,north:80,zoom:3};
 assert.equal(canHoldCertifiedSpatialViewport(prior,next,0,19900,20000),false);
 assert.equal(canHoldCertifiedSpatialViewport(prior,next,1,20000-SPATIAL_VIEWPORT_HOLD_MAX_MS,20000),false);
 assert.equal(spatialViewportOverlap(null,next),null);
 assert.equal(spatialViewportOverlap(prior,{...next,west:NaN}),null);
});

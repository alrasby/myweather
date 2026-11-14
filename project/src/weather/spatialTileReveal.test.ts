import assert from "node:assert/strict";
import {test} from "node:test";
import {softenSpatialTileArrival, type SpatialTileNode} from "./spatialTileReveal.ts";
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
 assert.equal(duration,190);
 assert.equal(softenSpatialTileArrival(tile,true,true),false);
 assert.equal(softenSpatialTileArrival(tile,false),false);
 tile.style.visibility="hidden";
 assert.equal(softenSpatialTileArrival(tile,true),false);
 assert.equal(calls,1);
 assert.equal(softenSpatialTileArrival({style:{visibility:"visible"}},true),false);
});

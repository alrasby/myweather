import test from "node:test";
import assert from "node:assert/strict";
import { createMetadataCache } from "./spatialMetadataWarmup.ts";

test("home warm request is reused by map until short TTL expires", async () => {
 let calls=0, time=100;
 const load=async ()=>({run:++calls});
 const read=createMetadataCache(load,()=>time,45_000);
 const a=read(), b=read();
 assert.strictEqual(a,b);
 assert.deepEqual(await a,{run:1});
 time+=44_999;
 assert.deepEqual(await read(),{run:1});
 time+=2;
 assert.deepEqual(await read(),{run:2});
 assert.equal(calls,2);
});
test("a failing prewarm is discarded immediately rather than poisoning map startup", async () => {
 let calls=0;
 const read=createMetadataCache(async()=>{
   calls++;
   if(calls===1) throw Error("offline");
   return {valid_times:["2026-11-15T12:00:00Z"]};
 });
 await assert.rejects(read(),/offline/);
 await Promise.resolve();
 assert.deepEqual(await read(),{valid_times:["2026-11-15T12:00:00Z"]});
 assert.equal(calls,2);
});
test("shared metadata is only a source reference, not a persisted weather raster", async()=>{
 const read=createMetadataCache(async()=>({reference_time:"2026-11-15T12:00Z",variables:["cloud_cover"]}));
 const item=await read();
 assert.deepEqual(Object.keys(item),["reference_time","variables"]);
});

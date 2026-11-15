import assert from "node:assert/strict";
import {test} from "node:test";
import {canRetainStartedEcmwfRange,certifiedAbortedEcmwfRange} from "./spatialCanceledRange.ts";
import {SpatialNativeQueue} from "./spatialNativeQueue.ts";
import {SpatialRangeFlights} from "./spatialRangeFlights.ts";
import {SpatialRangeCache} from "./spatialRangeCache.ts";
const file="https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/11/14/1800Z/2026-11-15T0500.om";
test("only small immutable per-hour ECMWF GET ranges can be kept after cancellation",()=>{
 assert.equal(canRetainStartedEcmwfRange(file,"GET","bytes=0-262143"),true);
 assert.equal(canRetainStartedEcmwfRange(file,"GET","bytes=262144-786431"),true);
 assert.equal(canRetainStartedEcmwfRange(file,"GET","bytes=0-524288"),false);
 assert.equal(canRetainStartedEcmwfRange(file,"HEAD","bytes=0-10"),false);
 assert.equal(canRetainStartedEcmwfRange(file,"GET",null),false);
 assert.equal(canRetainStartedEcmwfRange(file,"GET","bytes=0-NaN"),false);
 assert.equal(canRetainStartedEcmwfRange(file,"GET","bytes=20-10"),false);
 assert.equal(canRetainStartedEcmwfRange(file.replace("2026-11-15T0500.om","latest.json"),"GET","bytes=0-9"),false);
 assert.equal(canRetainStartedEcmwfRange("https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json","GET","bytes=0-9"),false);
 assert.equal(canRetainStartedEcmwfRange(file.replace("openmeteo.s3.amazonaws.com","example.com"),"GET","bytes=0-9"),false);
});
test("only complete source-backed 206 responses with EXACT Content-Range are eligible",()=>{
 const range="bytes=100-199",correct="bytes 100-199/123456";
 assert.equal(certifiedAbortedEcmwfRange(file,"GET",range,206,correct,100),true);
 for(const [status,contentRange,received] of [
   [200,correct,100],[206,correct,99],[206,"bytes 100-198/123456",100],
   [206,"bytes 101-200/123456",100],[206,"bytes 100-199/*",100],
   [206,"bytes 100-199/199",100],[206,null,100],
 ]) {
   assert.equal(certifiedAbortedEcmwfRange(file,"GET",range,status as number,
     contentRange as string|null,received as number),false,
     JSON.stringify({status,contentRange,received}));
 }
});

test("cancelled viewport rejects stale delivery but verified finished native bytes warm bounded cache",async()=>{
 const queue=new SpatialNativeQueue(1);
 const flights=new SpatialRangeFlights<Uint8Array>();
 const cache=new SpatialRangeCache(1024,512,300000);
 const range="bytes=100-199",key=file+"|"+range;
 let finish!:()=>void;
 let started=false;
 const controller=new AbortController();
 const delivered=flights.run(key,controller.signal,(sharedSignal)=>
   queue.run(sharedSignal,async()=>{
     started=true;
     await new Promise<void>(resolve=>{finish=resolve;});
     const bytes=new Uint8Array(100).fill(37);
     if(certifiedAbortedEcmwfRange(file,"GET",range,206,"bytes 100-199/123456",bytes.byteLength)){
       cache.put(key,{bytes,headers:{"content-range":"bytes 100-199/123456"},status:206});
     }
     return bytes;
   },1,canRetainStartedEcmwfRange(file,"GET",range)));
 // SpatialRangeFlights starts the shared operation in a microtask.
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(started,true);
 controller.abort();
 await assert.rejects(delivered,/spatial-request-aborted/);
 finish();
 for(let n=0;n<10&&!cache.get(key);n++)
   await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(cache.get(key)?.bytes.byteLength,100);
 assert.equal(cache.get(key)?.bytes[0],37);
 assert.equal(flights.active,0);
});

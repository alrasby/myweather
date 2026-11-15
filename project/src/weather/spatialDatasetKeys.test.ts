import assert from "node:assert/strict";
import {test} from "node:test";
import {SpatialDatasetKeys} from "./spatialDatasetKeys.ts";

const palette={breakpoints:[0,1,2],colors:[[0,0,0,0],[255,0,0,.5],[255,0,0,1]]};
function model(values:Float32Array){
 return {omFileUrl:"https://example.org/2026-11-13T06.om",
  dataOptions:{variable:"cloud_cover",deltaTimeHours:1,
   domain:{value:"ecmwf_ifs",grid:{type:"regular",nx:10,ny:10}}},
  ranges:[{start:0,end:100}],data:{values,scaleFactor:100}};
}
test("shallow state wrappers pointing at identical decoded grid share worker cache",()=>{
 const keys=new SpatialDatasetKeys(),values=new Float32Array([1,2,3]);
 const state=model(values),alias={...state,data:{...state.data}};
 assert.notStrictEqual(state,alias);
 assert.equal(keys.key(state as never,palette),keys.key(alias as never,palette));
});
test("new data, geographic domain, range, variable, palette or scale never reuse pixels",()=>{
 const keys=new SpatialDatasetKeys(),state=model(new Float32Array([1,2,3]));
 const id=keys.key(state as never,palette);
 assert.notEqual(keys.key(model(new Float32Array([1,2,3])) as never,palette),id);
 assert.notEqual(keys.key({...state,ranges:[{start:3,end:100}]} as never,palette),id);
 assert.notEqual(keys.key({...state,dataOptions:{...state.dataOptions,variable:"precipitation"}} as never,palette),id);
 assert.notEqual(keys.key({...state,dataOptions:{...state.dataOptions,
  domain:{...state.dataOptions.domain,grid:{type:"regular",nx:8,ny:8}}}} as never,palette),id);
 assert.notEqual(keys.key(state as never,{...palette,colors:[[0,0,0,0],[0,0,255,.5],[0,0,255,1]]}),id);
 assert.notEqual(keys.key({...state,data:{...state.data,scaleFactor:2}} as never,palette),id);
 assert.equal(keys.key(state as never,palette),id);
});
test("unloaded model data cannot be cached as a worker raster",()=>{
 assert.throws(()=>new SpatialDatasetKeys().key(
  {...model(new Float32Array([1])),data:null} as never,palette),/identity-missing/);
});

test("worker registration retains values, scale and key after upstream eviction",async()=>{
 const {captureSpatialWorkerData}=await import("./spatialDatasetKeys.ts");
 const keys=new SpatialDatasetKeys(),state=model(new Float32Array([9,10]));
 const captured=captureSpatialWorkerData(state as never,palette,keys);
 state.data=null as never;
 assert.equal(captured.scaleFactor,100);
 assert.deepEqual([...captured.values],[9,10]);
 assert.match(captured.dataKey,/^decoded-/);
 assert.throws(()=>captureSpatialWorkerData(state as never,palette,keys),/source-missing/);
});

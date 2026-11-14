import assert from "node:assert/strict";
import { test } from "node:test";
import { certifiedCurrentLeafletTiles } from "./spatialLeafletCoverage.ts";

const tile=(el:object, z=5, current=true, loaded=1234)=>({
  el, current, loaded, coords:{z},
});
const layer=(tiles:Record<string,ReturnType<typeof tile>>, pending=false, z=5)=>({
  _tiles:tiles, _tileZoom:z, isLoading:()=>pending,
});
test("a full old Leaflet image cache is valid for this viewport even without new tileload events",()=>{
 const a={},b={},c={};
 const delivered=new WeakSet<object>([a,b,c]);
 assert.equal(certifiedCurrentLeafletTiles(layer({
  "0":tile(a),"1":tile(b),"2":tile(c),
  "old":tile({},5,false)
 }),5,delivered),3);
});
test("never invent readiness from an unrelated, incomplete, aborted or loading tile",()=>{
 const a={},b={};const delivered=new WeakSet<object>([a,b]);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a),"b":tile(b)},true),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a),"b":tile(b)},false,4),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a,4)},false),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a,5,true,0)}),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a),"b":tile({})}),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a,5,false)}),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({}),5,delivered),0);
 assert.equal(certifiedCurrentLeafletTiles(layer({"a":tile(a)}),Number.NaN,delivered),0);
});
test("a new actual tileload certification makes the recovered viewport eligible",()=>{
 const a={},b={};const delivered=new WeakSet<object>([a]);
 const current=layer({"a":tile(a),"b":tile(b)});
 assert.equal(certifiedCurrentLeafletTiles(current,5,delivered),0);
 delivered.add(b);
 assert.equal(certifiedCurrentLeafletTiles(current,5,delivered),2);
});

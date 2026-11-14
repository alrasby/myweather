import assert from "node:assert/strict";
import { test } from "node:test";
import { certifiedCurrentLeafletTiles, currentLeafletCoverage } from "./spatialLeafletCoverage.ts";

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

test("a current but CSS-HIDDEN weather canvas is not complete; remove the hard rectangular source-switch race",()=>{
 const visible={style:{visibility:"",opacity:"1"}};
 const hidden={style:{visibility:"hidden",opacity:"1"}};
 const cert=new WeakSet<object>([visible,hidden]);
 const x=layer({"visible":tile(visible),"hidden":tile(hidden)});
 assert.equal(certifiedCurrentLeafletTiles(x,5,cert),0);
 assert.deepEqual(currentLeafletCoverage(x,5,cert),{
  required:2,delivered:1,pending:1,hidden:1,complete:false,
 });
 hidden.style.visibility="";
 assert.equal(certifiedCurrentLeafletTiles(x,5,cert),2);
 assert.equal(currentLeafletCoverage(x,5,cert).complete,true);
 hidden.style.opacity="0";
 assert.equal(certifiedCurrentLeafletTiles(x,5,cert),0);
 assert.equal(currentLeafletCoverage(x,5,cert).hidden,1);
});
test("current certified coverage never treats a pending request as a completed viewport",()=>{
 const a={style:{visibility:"",opacity:"1"}};
 const cert=new WeakSet<object>([a]);
 const active=layer({"a":tile(a)},true);
 assert.equal(currentLeafletCoverage(active,5,cert).complete,false);
 assert.equal(currentLeafletCoverage(active,5,cert).delivered,1);
});

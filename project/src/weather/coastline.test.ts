import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {isCoastalCity,parseShorelineIndex,shorelineDistanceKm} from "./coastline.ts";

test("global CC0 coastline places Muscat and other coastal cities by shore proximity",async()=>{
 const buf=await readFile(new URL("../../public/data/shoreline-v1.bin",import.meta.url));
 const index=parseShorelineIndex(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
 const cities=[
  ["Muscat",23.588,58.3829,true],
  ["Dubai",25.2048,55.2708,true],
  ["Mumbai",19.076,72.8777,true],
  ["Helsinki",60.1699,24.9384,true],
  ["Hammerfest",70.6634,23.6821,true],
  ["Riyadh",24.7136,46.6753,false],
  ["Prague",50.0755,14.4378,false],
 ];
 for(const [name,lat,lon,wanted] of cities){
  const km=shorelineDistanceKm(index,lat,lon);
  console.log("SHORELINE_COVERAGE",name,Number(km.toFixed(2)),wanted);
  assert.equal(isCoastalCity(index,lat,lon),wanted,name+" shoreKm="+km);
 }
});
test("shoreline data fails on truncated, malformed or corrupt indexes",async()=>{
 const buf=await readFile(new URL("../../public/data/shoreline-v1.bin",import.meta.url));
 const exact=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
 assert.throws(()=>parseShorelineIndex(exact.slice(0,1024)),/incomplete|invalid/);
 const wrong=exact.slice(0);
 new DataView(wrong).setUint32(4,99,true);
 assert.throws(()=>parseShorelineIndex(wrong),/invalid/);
 const corrupt=exact.slice(0);
 new DataView(corrupt).setUint32(16+180*4,0,true);
 assert.throws(()=>parseShorelineIndex(corrupt),/count|corrupt/);
});

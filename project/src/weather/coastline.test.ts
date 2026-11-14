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
 ] as const;
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

test("global coverage regression spans islands, hemispheres, polar coasts and inland continents",async()=>{
 const buf=await readFile(new URL("../../public/data/shoreline-v1.bin",import.meta.url));
 const index=parseShorelineIndex(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));
 const coastal=[
  ["Honolulu",21.3069,-157.8583],
  ["Papeete",-17.5516,-149.5585],
  ["Reykjavik",64.1466,-21.9426],
  ["Cape Town",-33.9249,18.4241],
  ["Ushuaia",-54.8019,-68.303],
  ["Sydney",-33.8688,151.2093],
  ["Nuku'alofa",-21.1394,-175.2049],
  ["Suva",-18.1416,178.4419],
  ["Auckland",-36.8485,174.7633],
  ["Miami",25.7617,-80.1918],
  ["Longyearbyen",78.2232,15.6469],
  ["Dakar",14.6928,-17.4467],
 ] as const;
 const inland=[
  ["Ulaanbaatar",47.9184,106.9177],
  ["Kathmandu",27.7172,85.3240],
  ["Denver",39.7392,-104.9903],
  ["Nairobi",-1.2921,36.8219],
  ["Canberra",-35.2809,149.1300],
  ["La Paz",-16.4897,-68.1193],
  ["Mexico City",19.4326,-99.1332],
  ["Alice Springs",-23.6980,133.8807],
 ] as const;
 for(const [name,lat,lon] of coastal){
  const km=shorelineDistanceKm(index,lat,lon);
  console.log("WORLD_COAST_QA",name,km.toFixed(2),"coastal");
  assert.ok(isCoastalCity(index,lat,lon),name+" should match a mapped ocean shore; "+km.toFixed(2)+"km");
 }
 for(const [name,lat,lon] of inland){
  const km=shorelineDistanceKm(index,lat,lon);
  console.log("WORLD_COAST_QA",name,km.toFixed(2),"inland");
  assert.equal(isCoastalCity(index,lat,lon),false,name+" inland; "+km.toFixed(2)+"km");
 }
});

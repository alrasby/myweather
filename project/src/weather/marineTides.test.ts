import assert from "node:assert/strict";
import {test} from "node:test";
import {marineGridDistanceKm,modelTideForecast,parseMarineSnapshot,hasDisplayableCoastalTide} from "./marineTides.ts";

const coastalCities=[
 ["Dubai",25.2048,55.2708,25.24,55.27],
 ["Mumbai",19.0760,72.8777,19.11,72.88],
 ["Helsinki",60.1699,24.9384,60.2,24.94],
 ["Hammerfest",70.6634,23.6821,70.68,23.70],
] as const;
const now=Date.UTC(2026,10,13,18);
const hour=3600000;
function response(lat:number,lon:number){
 const first=now-12*hour;
 const time=Array.from({length:84},(_,i)=>Math.round((first+i*hour)/1000));
 const height=time.map((_,i)=>Number(Math.sin(i*Math.PI/6).toFixed(3)));
 return {latitude:lat,longitude:lon,current:{wave_height:1.2},
  hourly:{time,sea_level_height_msl:height}};
}
test("all four user-requested shoreline cities match nearby marine model cells",()=>{
 for(const [name,lat,lon,gridLat,gridLon] of coastalCities){
  assert.ok(marineGridDistanceKm(lat,lon,gridLat,gridLon)<30,name);
  const marine=parseMarineSnapshot(response(gridLat,gridLon),lat,lon,now,1);
  assert.equal(marine?.coastal,true,name);
  assert.ok(marine?.tide?.points.length,name);
  assert.equal(hasDisplayableCoastalTide(marine,now),true,name);
  assert.equal(marine?.wave,1.2,name);
 }
});
test("actual model timestamps yield next high/low without synthetic amplitudes",()=>{
 const m=parseMarineSnapshot(response(25.24,55.27),25.2048,55.2708,now,1);
 const curve=modelTideForecast(m?.tide?.points,now);
 assert.ok(curve.nextHigh&&curve.nextLow);
 assert.ok(curve.nextHigh.t>now&&curve.nextLow.t>now);
 assert.ok(Math.abs(curve.nextHigh.level)<=1&&Math.abs(curve.nextLow.level)<=1);
 assert.ok(curve.points.length>=20);
 assert.equal(modelTideForecast(null,now).nextHigh,null);
 assert.equal(modelTideForecast([{t:now,level:0},{t:now+hour,level:1}],now).nextHigh,null);
});
test("sea-grid success for an inland place must NOT enable tide card",()=>{
 const inLand=parseMarineSnapshot(response(25.24,55.27),24.4,54.4,now);
 assert.equal(inLand?.coastal,false);
 assert.equal(inLand?.tide,null);
 assert.equal(parseMarineSnapshot({latitude:null,longitude:55},25,55,now),null);
});
test("missing, corrupt and stale sea-level time series cannot invent tide events",()=>{
 const bad=response(25.24,55.27);
 bad.hourly.sea_level_height_msl=[] as number[];
 assert.equal(parseMarineSnapshot(bad,25.2048,55.2708,now,1)?.tide,null);
 const stale=response(25.24,55.27);
 stale.hourly.time=stale.hourly.time.map(x=>x-10*86400);
 assert.equal(parseMarineSnapshot(stale,25.2048,55.2708,now,1)?.tide,null);
 const sparse=response(25.24,55.27);
 sparse.hourly.sea_level_height_msl[15]=Number.NaN;
 const m=parseMarineSnapshot(sparse,25.2048,55.2708,now,1);
 assert.ok(m?.tide?.points.every(p=>Number.isFinite(p.level)));
});
test("dateline distance uses shortest geographic path",()=>{
 assert.ok(marineGridDistanceKm(0,179.8,0,-179.8)<45);
});

test("inland or unavailable marine data hides tide card without exposing error copy",()=>{
 const coast=parseMarineSnapshot(response(25.24,55.27),25.2048,55.2708,now,1);
 assert.equal(hasDisplayableCoastalTide(null,now),false);
 assert.equal(hasDisplayableCoastalTide({coastal:false,wave:null,tide:coast?.tide},now),false);
 assert.equal(hasDisplayableCoastalTide({coastal:true,wave:1,tide:null},now),false);
 assert.equal(hasDisplayableCoastalTide({coastal:true,wave:1,tide:coast?.tide},now),true);
 assert.equal(hasDisplayableCoastalTide(coast,now+8*hour),false,"expired predictions are hidden");
 assert.equal(hasDisplayableCoastalTide(coast,now-hour),false,"future fetch stamps are not accepted");
 const justInland=parseMarineSnapshot(response(25.24,55.27),25.45,55.27,now);
 assert.equal(justInland?.coastal,false,"distant sea-grid cells cannot classify nearby inland towns as sea coast");
 assert.equal(hasDisplayableCoastalTide(justInland,now),false);
});

test("Muscat accepts real sea-level data 22.66km offshore only if its shoreline is nearby",()=>{
 const m=parseMarineSnapshot(response(23.791664,58.375015),23.588,58.3829,now,1.2);
 assert.ok(m?.coastal&&m.tide?.points.length);
 assert.ok(hasDisplayableCoastalTide(m,now));
 assert.equal(parseMarineSnapshot(response(23.791664,58.375015),23.588,58.3829,now,Infinity)?.coastal,false);
 assert.equal(parseMarineSnapshot(response(24.5,59.5),23.588,58.3829,now,1)?.coastal,false);
});

test("hour gaps cannot manufacture high/low times in an estimated sea-level curve", () => {
 const gap=[{t:now+hour,level:0.2},{t:now+4*hour,level:1.2},{t:now+5*hour,level:0.2}];
 const smooth=[{t:now+3*hour,level:0.2},{t:now+4*hour,level:1.2},{t:now+5*hour,level:0.2}];
 assert.equal(modelTideForecast(gap,now).nextHigh,null);
 assert.equal(modelTideForecast(smooth,now).nextHigh?.t,now+4*hour);
});

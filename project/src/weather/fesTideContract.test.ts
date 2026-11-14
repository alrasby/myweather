import assert from "node:assert/strict";
import {test} from "node:test";
import {parseFesPilotForecast} from "./fesTideContract.ts";

const start=Date.UTC(2026,10,14,0);
const lat=23.588,lon=58.3829,hours=12;
const stamp=(t:number)=>new Date(t).toISOString().replace(".000Z","Z");
function fixture(){
 const samples=Array.from({length:hours*12+1},(_,i)=>({
  time:stamp(start+i*300000),
  level_m:Number((Math.cos(i*Math.PI/36)*0.8).toFixed(4)),
 }));
 return {
  source:"FES2022b",method:"PyFES astronomical harmonic prediction",
  status:"physical_model_unvalidated_at_local_gauge",datum:"atlas_mean_sea_level",
  height_unit:"m",latitude:lat,longitude:lon,not_for_navigation:true,
  interpolation_points_min:4,start:stamp(start),end:stamp(start+hours*3600000),
  step_minutes:5,samples,
  extrema:[{kind:"low",time:samples[36].time,level_m:samples[36].level_m,time_resolution_minutes:5},
   {kind:"high",time:samples[72].time,level_m:samples[72].level_m,time_resolution_minutes:5}],
 };
}
const validate=(raw:unknown)=>parseFesPilotForecast(raw,lat,lon,start,hours);

test("the FES pilot stays explicitly unapproved even with valid model samples",()=>{
 const actual=validate(fixture());
 assert.ok(actual);
 assert.equal(actual.points.length,145);
 assert.equal(actual.extrema.length,2);
 assert.equal(actual.extrema[0]?.kind,"low");
 assert.equal(actual.datum,"atlas_mean_sea_level");
 assert.equal(actual.isApprovedForPublicDisplay,false);
});

test("never pretend an upstream total-sea-level or wrong-unit series is FES",()=>{
 const p=fixture();
 assert.equal(validate({...p,source:"Open-Meteo Marine"}),null);
 assert.equal(validate({...p,datum:"chart_datum"}),null);
 assert.equal(validate({...p,height_unit:"cm"}),null);
 assert.equal(validate({...p,status:"station_gauge_validated"}),null);
 assert.equal(validate({...p,not_for_navigation:false}),null);
 assert.equal(validate({...p,interpolation_points_min:-1}),null);
});

test("reject missing/out-of-order forecast samples, wrong station, and false extrema",()=>{
 const p=fixture();
 assert.equal(validate({...p,latitude:lat+0.01}),null);
 assert.equal(validate({...p,longitude:lon+0.01}),null);
 assert.equal(validate({...p,samples:p.samples.slice(0,-1)}),null);
 assert.equal(validate({...p,samples:p.samples.map((s,i)=>i===12?{...s,time:stamp(start+13*300000)}:s)}),null);
 assert.equal(validate({...p,samples:p.samples.map((s,i)=>i===12?{...s,level_m:Number.NaN}:s)}),null);
 assert.equal(validate({...p,extrema:[{kind:"high",time:stamp(start+18*300000),level_m:10,time_resolution_minutes:5}]}),null);
 assert.equal(validate({...p,extrema:[...p.extrema].reverse()}),null);
 assert.equal(validate({...p,start:stamp(start+300000)}),null);
});

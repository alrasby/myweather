import assert from "node:assert/strict";
import {test} from "node:test";
import {eot20GatewayUrl,parseEot20Forecast} from "./eot20TideClient.ts";

const lat=23.588,lon=58.3829,start=Date.UTC(2026,10,14,0),hours=12;
const stamp=(t:number)=>new Date(t).toISOString().replace(".000Z","Z");
function sample(){
 const samples=Array.from({length:hours*12+1},(_,i)=>({
  time:stamp(start+i*300000),level_m:Number((Math.cos(i*Math.PI/36)*0.8).toFixed(4)),
 }));
 return {
  source:"EOT20",model_version:"EOT20-final",
  method:"PyFES Darwin global astronomical tide",
  license:"CC-BY-4.0",
  citation:"Hart-Davis et al., https://doi.org/10.5194/essd-13-3869-2021",
  status:"physical_model_unvalidated_at_local_gauge",datum:"atlas_mean_sea_level",
  height_unit:"m",latitude:lat,longitude:lon,not_for_navigation:true,
  interpolation_points_min:4,step_minutes:5,
  start:stamp(start),end:stamp(start+hours*3600000),samples,
  extrema:[
   {kind:"low",time:samples[36]!.time,level_m:samples[36]!.level_m,time_resolution_minutes:5},
   {kind:"high",time:samples[72]!.time,level_m:samples[72]!.level_m,time_resolution_minutes:5},
  ],
 };
}
const parse=(value:unknown)=>parseEot20Forecast(value,lat,lon,start,hours);
test("EOT20 worldwide source is never presented as FES2022b or a calibrated harbour datum",()=>{
 const p=parse(sample());
 assert.ok(p);
 assert.equal(p.source,"EOT20");
 assert.equal(p.modelVersion,"EOT20-final");
 assert.equal(p.publiclyCalibrated,false);
 assert.equal(p.isApprovedForPublicDisplay,false);
 assert.equal(p.points.length,145);
 assert.equal(p.extrema.length,2);
});
test("reject forged global provider, wrong datum, missing source, false extrema and invalid location",()=>{
 const a=sample();
 assert.equal(parse({...a,source:"FES2022b"}),null);
 assert.equal(parse({...a,source:"NOAA_COOPS_STATION_HARMONICS"}),null);
 assert.equal(parse({...a,license:"unknown"}),null);
 assert.equal(parse({...a,method:"Open-Meteo Marine"}),null);
 assert.equal(parse({...a,citation:"not EOT20"}),null);
 assert.equal(parse({...a,datum:"harbour_chart_datum"}),null);
 assert.equal(parse({...a,not_for_navigation:false}),null);
 assert.equal(parse({...a,latitude:lat+1}),null);
 assert.equal(parse({...a,samples:a.samples.slice(1)}),null);
 assert.equal(parse({...a,extrema:[{kind:"high",time:a.samples[36]!.time,
 level_m:a.samples[36]!.level_m,time_resolution_minutes:5}]}),null);
});
test("public service must be HTTPS without userinfo or unbounded URL parts",()=>{
 assert.equal(eot20GatewayUrl("https://weather.example.test"),
  "https://weather.example.test/v1/tides");
 assert.equal(eot20GatewayUrl("https://weather.example.test/v1/tides"),
  "https://weather.example.test/v1/tides");
 for(const x of ["http://weather.example.test","https://user:pass@weather.example.test",
  "https://weather.example.test/?key=secret","https://weather.example.test/path",
  "https://weather.example.test/#fragment","javascript:alert(1)",""]) {
  assert.equal(eot20GatewayUrl(x),null,x);
 }
});

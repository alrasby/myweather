import test from "node:test";
import assert from "node:assert/strict";
import {scoreContinuous,scoreBinaryProbability} from "./forecastVerification.ts";
const t=Date.parse("2026-11-15T13:00:00.000Z");
const pair=(forecast:number,observed:number,delta=0)=>({
  variable:"temperature_2m",unit:"°C",forecastProvider:"Open-Meteo",
  observationProvider:"independent-station",forecastValidTimeMs:t,
  observedTimeMs:t+delta,forecast,observed,
});
test("WMO-style bias / MAE / RMSE score only matched valid-time observations",()=>{
 const rows=[pair(22,20),pair(17,20),pair(100,-20,3600_000),
   {...pair(22,20),unit:"°F"}, {...pair(20,20),observationProvider:" "}];
 const s=scoreContinuous(rows,"temperature_2m","°C");
 assert.equal(s.samples,2);
 assert.equal(s.excluded,3);
 assert.equal(s.bias,-0.5);
 assert.equal(s.mae,2.5);
 assert.ok(Math.abs((s.rmse??0)-Math.sqrt(6.5))<1e-12);
});
test("cannot announce accuracy where no independent matched observations exist",()=>{
 const rows=[pair(27,27,3600_000)];
 assert.deepEqual(scoreContinuous(rows,"temperature_2m","°C"),
   {samples:0,excluded:1,bias:null,mae:null,rmse:null});
 assert.throws(()=>scoreContinuous(rows,"temperature_2m","°C",-1),RangeError);
});
test("probability verification uses real outcomes and normalized input, never percent as probability",()=>{
 const proto={variable:"rain",unit:"event",forecastProvider:"Open-Meteo",
  observationProvider:"rain-gauge",forecastValidTimeMs:t,observedTimeMs:t};
 const p=[{...proto,probability:0.8,occurred:true},
  {...proto,probability:0.2,occurred:false},
  {...proto,probability:80,occurred:true},
  {...proto,probability:-0.1,occurred:false},
  {...proto,observationProvider:"",probability:0.9,occurred:true}];
 const s=scoreBinaryProbability(p,"rain","event");
 assert.equal(s.samples,2);
 assert.equal(s.excluded,3);
 assert.ok(Math.abs((s.brierScore??0)-0.04)<1e-12);
 assert.deepEqual(scoreBinaryProbability([],"rain","event"),
   {samples:0,excluded:0,brierScore:null});
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialFreshness } from "./spatialFreshness.ts";
const at=(h:number)=>Date.parse("2026-11-10T00:00:00Z")+h*3600_000;
const model=(ref:string, times:string[])=>({ completed:true, reference_time:ref, valid_times:times });
test("fresh ECMWF run with upcoming forecasts is accepted",()=>{
  const r=spatialFreshness(model(new Date(at(0)).toISOString(),[at(-2),at(0),at(1),at(2),at(24)].map(x=>new Date(x).toISOString())),at(1));
  assert.equal(r.valid,true);
});
test("an expired model run cannot be displayed under tomorrow's slider clock",()=>{
  const r=spatialFreshness(model(new Date(at(-140)).toISOString(),[at(-140),at(-100),at(-1)].map(x=>new Date(x).toISOString())),at(1));
  assert.equal(r.valid,false);
  assert.match(r.reason!,/expired/);
});
test("a run older than 48 hours is rejected even if its long horizon includes now",()=>{
  const r=spatialFreshness(model(new Date(at(-60)).toISOString(),[at(-60),at(1),at(50)].map(x=>new Date(x).toISOString())),at(1));
  assert.equal(r.valid,false);
  assert.match(r.reason!,/outdated/);
});
test("malformed/unfinished model metadata cannot masquerade as weather",()=>{
  assert.equal(spatialFreshness({completed:false,valid_times:[]},at(1)).valid,false);
  assert.equal(spatialFreshness({valid_times:["invalid"]},at(1)).valid,false);
});

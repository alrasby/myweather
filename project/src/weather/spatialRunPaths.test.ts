import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialOmFileUrl, spatialForecastIntervalHours } from "./spatialRunPaths.ts";
const ms=(t:string)=>Date.parse(t);
test("direct file uses reference run folder and forecast valid timestamp across UTC day boundary",()=>{
 const base="https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs";
 const ref=ms("2026-11-10T18:00Z");
 const run={referenceTime:ref,validTimes:[ref,ms("2026-11-11T00:00Z")]};
 assert.equal(spatialOmFileUrl(base,run,1),base+"/2026/11/10/1800Z/2026-11-11T0000.om");
});
test("spatial range resolves solely from trusted run/valid time, not local timezone",()=>{
 const base="https://example.com/data_spatial/ecmwf_ifs/";
 const run={referenceTime:ms("2026-11-10T06:00Z"),validTimes:[ms("2026-11-10T07:00Z")]};
 assert.equal(spatialOmFileUrl(base,run,0),"https://example.com/data_spatial/ecmwf_ifs/2026/11/10/0600Z/2026-11-10T0700.om");
 assert.equal(spatialOmFileUrl(base,run,1),null);
});
test("derive precipitation per-hour scaling from actual 3h model valid-time spacing",()=>{
 const t=[ms("2026-11-10T00:00Z"),ms("2026-11-10T01:00Z"),ms("2026-11-10T04:00Z")];
 assert.equal(spatialForecastIntervalHours(t,1),1);
 assert.equal(spatialForecastIntervalHours(t,2),3);
});

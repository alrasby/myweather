import test from "node:test";
import assert from "node:assert/strict";
import {validateDeviceEvidence} from "./device-qa-evidence.mjs";
const good=(tier)=>({
 tier,source:"physical-android",device:"synthetic fixture, NOT physical evidence",
 testedAt:"2026-11-15T09:00:00Z",ramGiB:tier==="low"?3:6,
 uiInteractionP95Ms:80,coldStartMs:2000,jsHeapGrowthMiB:10,
 nativePssGrowthMiB:12,crashes:0,mapFirstFrameP95Ms:6500,
 rtlArPass:true,ltrEnPass:true,textScale200Pass:true,touchPass:true,
 screenReaderPass:true,reducedMotionPass:true,unitsPass:true,timeZonePass:true,
 sourceAttributionPass:true,noClippingPass:true,noBlackMapGapsPass:true,
});
test("release gate refuses missing physical device benchmarks",()=>{
 assert.equal(validateDeviceEvidence({runs:[]}).ok,false);
 assert.equal(validateDeviceEvidence({runs:[good("mid")]}).ok,false);
});
test("validator detects failed RTL, slow UI, map gaps and missing provenance",()=>{
 const bad={...good("low"),rtlArPass:false,noBlackMapGapsPass:false,uiInteractionP95Ms:300,sourceAttributionPass:false};
 const r=validateDeviceEvidence({runs:[bad,good("mid")]});
 assert.equal(r.ok,false);
 for(const v of ["rtlArPass","noBlackMapGapsPass","UI p95","sourceAttributionPass"])assert.ok(r.errors.some(e=>e.includes(v)),v);
});
test("synthetic conforming fixtures only verify schema validation code",()=>{
 assert.equal(validateDeviceEvidence({runs:[good("low"),good("mid")]}).ok,true);
});

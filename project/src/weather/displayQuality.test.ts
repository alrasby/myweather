import test from "node:test";
import assert from "node:assert/strict";
import {dayKey} from "./calendarDayKey.ts";
import {convertTemp,convertWind,convertPressure,convertDistance} from "./unitConversion.ts";
const close=(actual:number,expected:number,tol=1e-5)=>
  assert.ok(Math.abs(actual-expected)<tol,`${actual} != ${expected}`);
test("city-local calendar day survives GMT+4 midnight and opposite global date",()=>{
 const instant=Date.parse("2026-11-15T21:30:00Z");
 assert.equal(dayKey(instant,"Asia/Muscat"),"2026-11-16");
 assert.equal(dayKey(instant,"America/Los_Angeles"),"2026-11-15");
 assert.equal(dayKey(instant,"Pacific/Auckland"),"2026-11-16");
});
test("city calendar uses IANA daylight-saving rules and fallback is UTC",()=>{
 assert.equal(dayKey(Date.parse("2026-03-29T21:45:00Z"),"Europe/Helsinki"),"2026-03-30");
 assert.equal(dayKey(Date.parse("2026-11-01T07:00:00Z"),"America/New_York"),"2026-11-01");
 assert.equal(dayKey(Date.parse("2026-11-15T21:30:00Z"),"Invalid/Zone"),"2026-11-15");
 assert.equal(dayKey(Number.NaN,"Asia/Muscat"),"");
});
test("temperature, wind, pressure and visibility unit conversions retain precision",()=>{
 close(convertTemp(0,"f"),32);
 close(convertTemp(-40,"f"),-40);
 close(convertTemp(18,"c"),18);
 close(convertWind(36,"ms"),10);
 close(convertWind(100,"mph"),62.1371);
 close(convertWind(100,"kn"),53.9957);
 close(convertWind(75,"kmh"),75);
 close(convertPressure(1013.25,"inhg"),29.921252,0.0001);
 close(convertPressure(1013.25,"hpa"),1013.25);
 close(convertDistance(1000,"km"),1);
 close(convertDistance(1609.344,"mi"),1.000000,0.00001);
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {mapForecastClock} from "./mapForecastClock.ts";

const h = (utc:string) => Date.parse(utc);
const at16=h("2026-11-14T16:00:00Z");
const at17=h("2026-11-14T17:00:00Z");
const next1=h("2026-11-15T01:00:00Z");

test("one complete ECMWF hour agrees with London 4 PM: preserve precise timeline clock",()=>{
  assert.deepEqual(mapForecastClock(at16,[at16]),{
    timeMs:at16,status:"timeline",gapMinutes:0,
  });
  assert.deepEqual(mapForecastClock(at16+29*60000,[at16]),{
    timeMs:at16,status:"corrected-real-frame",gapMinutes:29,
  });
});
test("legitimate adjacent ECMWF blend preserves continuous UTC slider time",()=>{
  const half=at16+30*60000;
  assert.deepEqual(mapForecastClock(half,[at16,at17]),{
    timeMs:half,status:"timeline",gapMinutes:30,
  });
});
test("held authentic source hour replaces falsely advanced slider label",()=>{
  assert.deepEqual(mapForecastClock(next1,[at16],true),{
    timeMs:at16,status:"held-real-frame",gapMinutes:540,
  });
  assert.equal(mapForecastClock(at16+15*60000,[at16],true).timeMs,at16);
});
test("London 16Z text can never label ECMWF 01Z raster without an audit signal",()=>{
  assert.deepEqual(mapForecastClock(at16,[next1]),{
    timeMs:next1,status:"corrected-real-frame",gapMinutes:540,
  });
});
test("an absent or invisible ECMWF source retains actual fallback forecast clock",()=>{
  assert.deepEqual(mapForecastClock(at16,[]),{
    timeMs:at16,status:"timeline",gapMinutes:null,
  });
  assert.equal(mapForecastClock(at16,[Number.NaN,Number.POSITIVE_INFINITY]).timeMs,at16);
  assert.equal(mapForecastClock(at16,[at16+40*60000]).timeMs,at16+40*60000);
});

test("Android regression: 02:59:56 slider cannot label only visible ECMWF 02:00 raster as 03:00",()=>{
  const source=h("2026-11-15T02:00:00.000Z");
  const timeline=h("2026-11-15T02:59:56.580Z");
  assert.deepEqual(mapForecastClock(timeline,[source]),{
    timeMs:source,status:"corrected-real-frame",gapMinutes:60,
  });
});
test("one real visible source hour stays fixed during slow third-hour decode",()=>{
  const source=h("2026-11-15T02:00:00Z");
  for(const minute of [1,9,29,45,59]){
    const shown=mapForecastClock(source+minute*60000,[source]);
    assert.equal(shown.timeMs,source,"a single frame has an unambiguous valid time");
    assert.equal(shown.status,"corrected-real-frame");
    assert.equal(shown.gapMinutes,minute);
  }
});
test("two identical source frame timestamps cannot masquerade as a real two-hour blend",()=>{
  const timestamp=h("2026-11-15T02:00:00Z");
  assert.equal(mapForecastClock(timestamp+30*60000,[timestamp,timestamp]).timeMs,timestamp);
});
test("both real 02:00 and 03:00 frames restore smooth slider labels only when visible together",()=>{
  const source=h("2026-11-15T02:00:00Z");
  const next=source+60*60000;
  const timeline=source+59*60000;
  assert.deepEqual(mapForecastClock(timeline,[source,next]),{
    timeMs:timeline,status:"timeline",gapMinutes:1,
  });
});

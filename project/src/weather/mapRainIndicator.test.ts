import test from "node:test";
import assert from "node:assert/strict";
import {mapRainReading} from "./mapRainIndicator.ts";
import {MUSCAT,type WeatherBundle} from "./types.ts";
const when=Date.parse("2026-11-15T08:00:00Z");
const point={
 placeId:MUSCAT.id,forecastSource:"open-meteo-best-match",hourly:[
   {t:when-3_600_000,precip:0.1},
   {t:when,precip:0},
   {t:when+3_600_000,precip:2.8},
 ],
} as WeatherBundle;
const base={
 sample:null,estimated:true,place:MUSCAT,point,
 center:{lat:MUSCAT.lat,lng:MUSCAT.lon},displayedTimeMs:when,
};
test("real point forecast at map center displays a valid zero instead of a dash",()=>{
 assert.deepEqual(mapRainReading(base),{amountMm:0,origin:"point-forecast"});
 assert.deepEqual(mapRainReading({...base,displayedTimeMs:when+3_600_000}),{amountMm:2.8,origin:"point-forecast"});
});
test("real source-grid rain supersedes point number and zero remains meaningful",()=>{
 const sample={rain:1.35,temp:24,spd:4,u:1,v:2,dirFrom:20,dirTo:200};
 assert.deepEqual(mapRainReading({...base,sample,estimated:false}),{amountMm:1.35,origin:"source-grid"});
 assert.deepEqual(mapRainReading({...base,sample:{...sample,rain:0},estimated:false}),{amountMm:0,origin:"source-grid"});
});
test("synthetic grid, unknown provenance, distant center and stale hour cannot fabricate rain",()=>{
 const badSample={rain:9,temp:24,spd:4,u:1,v:2,dirFrom:20,dirTo:200};
 const missing={amountMm:null,origin:"missing"};
 assert.deepEqual(mapRainReading({...base,sample:badSample,estimated:true,point:null}),missing);
 assert.deepEqual(mapRainReading({...base,point:{...point,forecastSource:undefined} as WeatherBundle}),missing);
 assert.deepEqual(mapRainReading({...base,center:{lat:0,lng:0}}),missing);
 assert.deepEqual(mapRainReading({...base,displayedTimeMs:when+10*3_600_000}),missing);
 assert.deepEqual(mapRainReading({...base,point:{...point,placeId:"wrong"} as WeatherBundle}),missing);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {comparePointWithSpatial,type CityForecastPoint} from './forecastSourceComparison.ts';
const current=Date.parse('2026-11-14T16:00:00.000Z');
const london:CityForecastPoint={
 placeId:'city',timezone:'Europe/London',fetchedAt:current+5*60000,
 forecastSource:'open-meteo-best-match',
 current:{t:current,code:0,cloud:8},
};
test('London point weather at 16Z must not be called a simultaneous map forecast at 01Z next day',()=>{
 const x=comparePointWithSpatial(london,'2026-11-15T01:00:00.000Z');
 assert.ok(x);
 assert.equal(x.absoluteTimeGapMinutes,540);
 assert.equal(x.sameForecastHour,false);
 assert.equal(x.comparisonScope,'different-forecast-hours');
 assert.equal(x.pointProvider,'open-meteo-best-match');
 assert.equal(x.pointWmoCode,0);
 assert.equal(x.pointCloudCoverPct,8);
 assert.equal(x.pointValidTime,'2026-11-14T16:00:00.000Z');
 assert.equal(x.mapEcmwfValidTime,'2026-11-15T01:00:00.000Z');
});
test('same exact UTC hour still discloses differing point and ECMWF model providers',()=>{
 const x=comparePointWithSpatial({...london,forecastSource:'met-no'},'2026-11-14T16:00:00.000Z');
 assert.equal(x?.sameForecastHour,true);
 assert.equal(x?.comparisonScope,'same-hour-different-models');
 assert.equal(x?.pointProvider,'met-no');
 assert.equal(x?.absoluteTimeGapMinutes,0);
});
test('unknown old cached provider, missing map frame or invalid values never imply weather certainty',()=>{
 const x=comparePointWithSpatial({...london,forecastSource:undefined,current:{t:1e30,code:120,cloud:-8}},null);
 assert.equal(x?.pointProvider,'unknown-cached-provider');
 assert.equal(x?.pointValidTime,null);
 assert.equal(x?.mapEcmwfValidTime,null);
 assert.equal(x?.comparisonScope,'time-unavailable');
 assert.equal(x?.pointWmoCode,null);
 assert.equal(x?.pointCloudCoverPct,null);
 assert.equal(x?.sameForecastHour,false);
 assert.equal(comparePointWithSpatial(null,'2026-11-14T16:00:00Z'),null);
});

test('source comparison cannot label adjacent UTC hour buckets as the same hour',()=>{
 const lastMinute={...london,current:{...london.current,t:current+59*60000}};
 const nextHour=comparePointWithSpatial(lastMinute,'2026-11-14T17:01:00Z');
 assert.equal(nextHour?.absoluteTimeGapMinutes,2);
 assert.equal(nextHour?.sameForecastHour,false);
 assert.equal(nextHour?.comparisonScope,'different-forecast-hours');
 const within=comparePointWithSpatial(lastMinute,'2026-11-14T16:01:00Z');
 assert.equal(within?.sameForecastHour,true);
 const boundary=comparePointWithSpatial(london,'2026-11-14T17:00:00Z');
 assert.equal(boundary?.sameForecastHour,false);
});

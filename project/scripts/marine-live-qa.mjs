/** Independently verify source-backed tide grid coverage for four user-supplied
 * coastal cities. Runs only in a dedicated live QA workflow, never as a
 * network-dependent unit test or APK startup action. */
import assert from "node:assert/strict";
import {parseMarineSnapshot,modelTideForecast,marineGridDistanceKm} from "../src/weather/marineTides.ts";
const cities=[
 {name:"Dubai",latitude:25.2048,longitude:55.2708},
 {name:"Mumbai",latitude:19.0760,longitude:72.8777},
 {name:"Helsinki",latitude:60.1699,longitude:24.9384},
 {name:"Hammerfest",latitude:70.6634,longitude:23.6821},
];
const reports=[];
for(const city of cities){
 const u=new URL("https://marine-api.open-meteo.com/v1/marine");
 for(const [k,v] of Object.entries({
  latitude:city.latitude,longitude:city.longitude,current:"wave_height",
  hourly:"sea_level_height_msl",forecast_days:3,past_days:1,
  timezone:"UTC",timeformat:"unixtime",cell_selection:"sea",
 }))u.searchParams.set(k,String(v));
 const res=await fetch(u,{signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw new Error(city.name+": Marine API "+res.status);
 const json=await res.json();
 const now=Date.now();
 const marine=parseMarineSnapshot(json,city.latitude,city.longitude,now);
 const distance=marineGridDistanceKm(city.latitude,city.longitude,json.latitude,json.longitude);
 const tide=modelTideForecast(marine?.tide?.points,now);
 const report={city:city.name,coastal:marine?.coastal,
  seaGridKm:Number(distance.toFixed(2)),points:marine?.tide?.points.length??0,
  nextHigh:tide.nextHigh?.t??null,nextLow:tide.nextLow?.t??null,
  available:!!marine?.tide,sourceModel:"Open-Meteo Marine sea_level_height_msl"};
 reports.push(report);
 console.log("MARINE_LIVE_QA "+JSON.stringify(report));
 assert.equal(marine?.coastal,true,city.name+" unexpectedly classified inland");
 assert.ok(marine?.tide?.points.length&&marine.tide.points.length>=12,
   city.name+" missing genuine sea-level model series");
 // Some coasts have predominantly diurnal tides. Do not assert both high
 // and low every 12h or fabricate an astronomical signal to pass.
}
console.log("MARINE_LIVE_QA_SUCCESS "+reports.length+" real coastal model series");

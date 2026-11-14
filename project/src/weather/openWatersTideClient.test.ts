import assert from "node:assert/strict";
import {test} from "node:test";
import {OPEN_WATERS_STATION_MAX_KM,parseOpenWatersTide} from "./openWatersTideClient.ts";
const H=3600000, now=Date.UTC(2026,10,14,10);
const station={
 id:"ticon/muscat-110-omn-uhslc_fd",name:"Muscat",
 attribution:"TICON-4, Hart-Davis et al. 2025, CC BY 4.0 (via Slackwater)",
 license:{type:"cc-by-4.0",commercial_use:true}
};
const points=Array.from({length:145},(_,i)=>({
 time:new Date(now-H+i*10*60000).toISOString(),level:1+Math.cos(i*Math.PI/36)
}));
const events=[
 {time:new Date(now+5*H).toISOString(),level:0.5,high:false,low:true},
 {time:new Date(now+11*H).toISOString(),level:2.0,high:true,low:false},
 {time:new Date(now+17*H).toISOString(),level:0.6,high:false,low:true},
];
const timeline={station,distance:19.08,units:"meters",datum:"LAT",timeline:points};
const extremes={station,distance:19.08,units:"meters",datum:"LAT",extremes:events};
const parse=(a:unknown=timeline,b:unknown=extremes)=>parseOpenWatersTide(a,b,now);
test("source-backed nearby keyless station is accepted with correct vertical datum",()=>{
 const f=parse();assert.ok(f);
 assert.equal(f.source,"OPEN_WATERS_STATION");
 assert.equal(f.stationName,"Muscat");assert.equal(f.datum,"LAT");
 assert.equal(f.points.length,145);assert.equal(f.extrema.length,3);
 assert.equal(f.distanceKm,19.08);assert.ok(f.attribution.includes("TICON"));
});
test("cannot show distant Rabat substitute as local tide",()=>{
 assert.equal(OPEN_WATERS_STATION_MAX_KM,30);
 assert.equal(parse({...timeline,distance:248.1},{...extremes,distance:248.1}),null);
});
test("reject noncommercial, unattributed, mismatched or malformed harmonics",()=>{
 assert.equal(parse({...timeline,station:{...station,license:{type:"cc-by-nc",commercial_use:false}}}),null);
 assert.equal(parse({...timeline,station:{...station,attribution:""}}),null);
 assert.equal(parse(timeline,{...extremes,station:{...station,id:"other"}}),null);
 assert.equal(parse(timeline,{...extremes,datum:"MSL"}),null);
 assert.equal(parse({...timeline,units:"feet"}),null);
 assert.equal(parse({...timeline,timeline:points.slice(0,3)}),null);
 assert.equal(parse({...timeline,timeline:[...points.slice(0,10),{time:points[10]!.time,level:100},...points.slice(11)]}),null);
 assert.equal(parse({...timeline,timeline:[...points.slice(0,10),points[9],...points.slice(11)]}),null);
 assert.equal(parse(timeline,{...extremes,extremes:[{...events[0],high:true,low:true},...events.slice(1)]}),null);
 assert.equal(parse(timeline,{...extremes,extremes:[]}),null);
 assert.equal(parse(timeline,{...extremes,extremes:[{...events[0],time:"yesterday"},...events.slice(1)]}),null);
});
test("public-domain NOAA station remains eligible with attribution",()=>{
 const noaa={...station,id:"noaa/9414290",license:{type:"public domain",commercial_use:true}};
 assert.ok(parse({...timeline,station:noaa},{...extremes,station:noaa}));
});

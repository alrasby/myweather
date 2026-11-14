import assert from "node:assert/strict";
import {test} from "node:test";
import {moonRiseSet} from "./astro.ts";

const localDate=(time:number,zone:string):string=>
 new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"})
  .format(new Date(time));

test("moonrise and moonset describe the complete local calendar day, independent of current hour",()=>{
 for(const [city,lat,lon,tz,date] of [
  ["Muscat",23.588,58.3829,"Asia/Muscat","2026-11-14"],
  ["New York",40.7128,-74.006,"America/New_York","2026-11-14"],
  ["Cape Town",-33.925,18.423,"Africa/Johannesburg","2026-11-14"],
 ] as const){
  const morning=Date.parse(date+"T11:00:00Z");
  const afternoon=morning+6*3600000;
  // For all zones pick two UTC times in the SAME local date.
  const a=moonRiseSet(lat,lon,morning,tz);
  const b=moonRiseSet(lat,lon,afternoon,tz);
  const rise=a.rise??b.rise,set=a.set??b.set;
  assert.ok(rise!==null||set!==null,city+": has at least one real daily event");
  for(const x of [rise,set]){
   if(x!==null)assert.equal(localDate(x,tz),localDate(morning,tz),
    city+": event cannot accidentally belong to another calendar day");
  }
  if(localDate(morning,tz)===localDate(afternoon,tz)){
   assert.equal(a.rise,b.rise,city+": event should not disappear late in day");
   assert.equal(a.set,b.set,city+": event should not disappear late in day");
  }
 }
});

test("moonrise never fabricates crossings from invalid coordinates or time zones",()=>{
 for(const [lat,lon,time,zone] of [
  [91,22,Date.now(),"UTC"],[20,-190,Date.now(),"UTC"],
  [NaN,22,Date.now(),"UTC"],[20,22,NaN,"UTC"],
  [20,22,Date.now(),"Bad/Timezone"],
 ] as const){
  assert.deepEqual(moonRiseSet(lat,lon,time,zone),{rise:null,set:null});
 }
});

test("high latitude moon can legitimately have no event on a local day",()=>{
 const now=Date.parse("2026-11-14T08:00:00Z");
 const a=moonRiseSet(70.663,23.682,now,"Europe/Oslo");
 for(const x of [a.rise,a.set]){
  if(x!==null)assert.equal(localDate(x,"Europe/Oslo"),localDate(now,"Europe/Oslo"));
 }
});

/** Open-Meteo Marine's sea_level_height_msl is the modelled sea-surface
 * height including tides, weather and ocean effects, relative to global MSL.
 * It is NOT chart datum, a calibrated tide gauge or navigation-grade data.
 * This module deliberately NEVER invents an astronomical tide signal. */
import type {MarineSnap} from "./types";
import {COASTAL_CITY_MAX_KM,MAX_OFFSHORE_MODEL_CELL_KM} from "./coastline.ts";

export type TidePoint={t:number;level:number};
export type TideExtreme=TidePoint&{kind:"high"|"low"};
export type TideReading={
 points:TidePoint[];
 events:TideExtreme[];
 nextHigh:TideExtreme|null;
 nextLow:TideExtreme|null;
 currentLevel:number|null;
};

function finite(v:unknown):v is number{
 return typeof v==="number"&&Number.isFinite(v);
}
export function marineGridDistanceKm(lat:number,lon:number,gridLat:number,gridLon:number):number{
 if(![lat,lon,gridLat,gridLon].every(Number.isFinite))return Infinity;
 const a=lat*Math.PI/180,b=gridLat*Math.PI/180;
 const dLat=b-a;
 const dLon=Math.atan2(Math.sin((gridLon-lon)*Math.PI/180),Math.cos((gridLon-lon)*Math.PI/180));
 const h=Math.sin(dLat/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dLon/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function parseMarineSnapshot(raw:unknown,lat:number,lon:number,now=Date.now(),shoreKm=Infinity):MarineSnap|null{
 if(!raw||typeof raw!=="object")return null;
 const src=raw as {latitude?:unknown;longitude?:unknown;current?:{wave_height?:unknown};
   hourly?:{time?:unknown;sea_level_height_msl?:unknown}};
 if(!finite(src.latitude)||!finite(src.longitude))return null;
 // The nearest SEA model cell can be quite remote for an inland city.
 // A successful API call alone is not evidence of coastal eligibility.
 // A real shoreline is independent of the 0.08-degree marine model grid.
 // Muscat's nearest sea-level model cell is 22.66 km offshore.
 const coastal=shoreKm<=COASTAL_CITY_MAX_KM&&
   marineGridDistanceKm(lat,lon,src.latitude,src.longitude)<=MAX_OFFSHORE_MODEL_CELL_KM;
 if(!coastal)return {coastal:false,wave:null,tide:null};
 const wave=finite(src.current?.wave_height)&&src.current.wave_height>=0
   ?src.current.wave_height:null;
 const times=src.hourly?.time,values=src.hourly?.sea_level_height_msl;
 const points:TidePoint[]=[];
 if(Array.isArray(times)&&Array.isArray(values)){
  const count=Math.min(times.length,values.length,130);
  for(let i=0;i<count;i++){
   const stamp=times[i],h=values[i];
   // timeformat=unixtime: exact seconds since UTC epoch, regardless of city TZ.
   const t=finite(stamp)?stamp*1000:NaN;
   if(finite(t)&&finite(h)&&Math.abs(h)<=25&&
     t>=now-36*3600000&&t<=now+100*3600000&&
     (points.length===0||t>points[points.length-1]!.t))
    points.push({t,level:h});
  }
 }
 // No fabricated events if the model doesn't provide a full meaningful curve.
 const available=points.length>=8&&points[0]!.t<=now+3600000&&
   points[points.length-1]!.t>=now+12*3600000;
 return {coastal:true,wave,tide:available?{fetchedAt:now,points}:null};
}
export function modelTideForecast(points:readonly TidePoint[]|null|undefined,now:number):TideReading{
 const samples=(points??[]).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.level))
  .slice().sort((a,b)=>a.t-b.t);
 const show=samples.filter(p=>p.t>=now-3*3600000&&p.t<=now+24*3600000);
 const events:TideExtreme[]=[];
 for(let i=1;i<samples.length-1;i++){
  const prev=samples[i-1]!,at=samples[i]!,next=samples[i+1]!;
  if(at.t<now-5*60000||at.t>now+48*3600000)continue;
  // The source provides discrete hourly values. Missing hours may create
  // artificial turning points if a discontinuity is treated as a smooth
  // astronomical tide curve. Require neighboring genuine model samples.
  if(at.t<=prev.t||next.t<=at.t||at.t-prev.t>2*3600000||next.t-at.t>2*3600000)continue;
  const a=at.level-prev.level,b=next.level-at.level;
  const kind=a>0.005&&b<=-0.005?"high":a< -0.005&&b>=0.005?"low":null;
  if(kind)events.push({...at,kind});
 }
 let currentLevel:number|null=null;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1]!,b=samples[i]!;
  if(a.t<=now&&b.t>=now&&b.t-a.t<=2*3600000){
   currentLevel=a.level+(b.level-a.level)*(now-a.t)/(b.t-a.t);
   break;
  }
 }
 return {points:show,events:events.slice(0,4),
  nextHigh:events.find(e=>e.kind==="high")??null,
  nextLow:events.find(e=>e.kind==="low")??null,currentLevel};
}

/** Show the whole marine card only when source-backed recent, coherent
 * sea-level samples exist. Lack of a Marine response is not an error to
 * display to an inland user. This check is intentionally city-name agnostic.
 */
export function hasDisplayableCoastalTide(marine:MarineSnap|null|undefined,now:number):boolean{
 const tide=marine?.tide;
 if(marine?.coastal!==true||!tide||!Number.isFinite(now)||
    !Number.isFinite(tide.fetchedAt)||now-tide.fetchedAt<0||
    now-tide.fetchedAt>=8*3600000||!Array.isArray(tide.points))return false;
 let recent=0,forward=false;
 for(const p of tide.points){
  if(!Number.isFinite(p.t)||!Number.isFinite(p.level))continue;
  if(p.t>=now-3*3600000&&p.t<=now+24*3600000)recent++;
  if(p.t>=now+6*3600000&&p.t<=now+24*3600000)forward=true;
 }
 return recent>=6&&forward;
}

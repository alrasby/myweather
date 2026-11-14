/** Registration-free astronomical tides from real station harmonics.
 * Open Waters / Slackwater: https://openwaters.io/api/tides/
 * Only nearby verified, commercially reusable stations are accepted. Unlike
 * EOT20 this is NOT a tide prediction for an arbitrary ocean coordinate.
 */
export type OpenWatersTideForecast = Readonly<{
  source:"OPEN_WATERS_STATION";
  stationId:string; stationName:string; distanceKm:number;
  datum:string; attribution:string; license:string;
  points: {t:number;levelM:number}[];
  extrema: {t:number;levelM:number;kind:"high"|"low"}[];
}>;

export const OPEN_WATERS_STATION_MAX_KM=30;
const ROOT="https://api.openwaters.io/tides";
const HOUR=3600000;
const SIX_HOURS=6*HOUR;
const CACHE_MS=45*60000;
const cache=new Map<string,{at:number;forecast:OpenWatersTideForecast}>();

function object(v:unknown):v is Record<string,unknown>{
 return !!v&&typeof v==="object"&&!Array.isArray(v);
}
function validTime(v:unknown):number|null {
 if(typeof v!=="string" || v.length>45 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(v))return null;
 const parsed=Date.parse(v);
 return Number.isFinite(parsed)?parsed:null;
}
function boundedLevel(v:unknown):v is number {
 return typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=30;
}
function verifiedStation(raw:unknown):raw is Record<string,unknown>{
 if(!object(raw)||typeof raw.id!=="string"||raw.id.length>140||
    typeof raw.name!=="string"||raw.name.length>150||
    typeof raw.attribution!=="string"||raw.attribution.length<20||raw.attribution.length>3000||
    !object(raw.license) || raw.license.commercial_use!==true ||
    !["public domain","cc-by-4.0","cc0","cc-by"].includes(String(raw.license.type).toLowerCase()))
    return false;
 return true;
}
function verifiedEnvelope(raw:unknown):raw is Record<string,unknown>{
 return object(raw)&&raw.units==="meters"&&typeof raw.datum==="string"&&
    raw.datum.length>0&&raw.datum.length<25&&verifiedStation(raw.station)&&
    typeof raw.distance==="number"&&Number.isFinite(raw.distance)&&
    raw.distance>=0&&raw.distance<=OPEN_WATERS_STATION_MAX_KM;
}
export function parseOpenWatersTide(
 timelineRaw:unknown,extremesRaw:unknown, now:number
):OpenWatersTideForecast|null {
 if(!Number.isFinite(now)||!verifiedEnvelope(timelineRaw)||!verifiedEnvelope(extremesRaw))return null;
 const a=timelineRaw,b=extremesRaw;
 const st=a.station as Record<string,unknown>, other=b.station as Record<string,unknown>;
 if(st.id!==other.id||a.datum!==b.datum||
   Math.abs((a.distance as number)-(b.distance as number))>2 ||
   !verifiedStation(other)||!Array.isArray(a.timeline)||!Array.isArray(b.extremes) ||
   a.timeline.length<24||a.timeline.length>650||b.extremes.length<1||b.extremes.length>45)return null;
 const points:{t:number;levelM:number}[]=[];
 for(const item of a.timeline){
  if(!object(item)||!boundedLevel(item.level))return null;
  const t=validTime(item.time);
  if(t===null|| (points.length>0&&
     (t<=points[points.length-1]!.t||t-points[points.length-1]!.t>HOUR)))return null;
  points.push({t,levelM:item.level});
 }
 if(points[0]!.t>now+HOUR||points[points.length-1]!.t<now+8*HOUR)return null;
 const extrema:{t:number;levelM:number;kind:"high"|"low"}[]=[];
 for(const item of b.extremes){
  if(!object(item)||!boundedLevel(item.level)||typeof item.high!=="boolean"||
     typeof item.low!=="boolean"||item.high===item.low)return null;
  const t=validTime(item.time);
  if(t===null||t<points[0]!.t-HOUR||t>points[points.length-1]!.t+HOUR||
     (extrema.length>0&&t<=extrema[extrema.length-1]!.t))return null;
  extrema.push({t,levelM:item.level,kind:item.high?"high":"low"});
 }
 if(!extrema.some(x=>x.t>=now))return null;
 return {
  source:"OPEN_WATERS_STATION",stationId:st.id as string,
  stationName:st.name as string,distanceKm:a.distance as number,
  datum:a.datum as string,attribution:st.attribution as string,
  license:String((st.license as Record<string,unknown>).type),
  points,extrema
 };
}
async function fetchJson(path:string,params:URLSearchParams,signal:AbortSignal):Promise<unknown>{
 const response=await fetch(ROOT+path+"?"+params.toString(),{
  signal,headers:{Accept:"application/json"},cache:"no-store"
 });
 if(!response.ok)return null;
 const size=response.headers.get("content-length");
 if(size!==null&&Number(size)>200000)return null;
 const value=await response.text();
 if(value.length>200000)return null;
 return JSON.parse(value) as unknown;
}
export async function fetchOpenWatersTide(
 lat:number,lon:number,now:number,signal:AbortSignal
):Promise<OpenWatersTideForecast|null> {
 if(signal.aborted||![lat,lon,now].every(Number.isFinite)||
    Math.abs(lat)>90||Math.abs(lon)>180)return null;
 const bucket=Math.floor(now/SIX_HOURS);
 const key=lat.toFixed(4)+":"+lon.toFixed(4)+":"+bucket;
 const saved=cache.get(key);
 if(saved && now-saved.at<CACHE_MS &&
    saved.forecast.points[saved.forecast.points.length-1]!.t>=now+8*HOUR)return saved.forecast;
 const start=(bucket-1)*SIX_HOURS;
 const end=start+48*HOUR;
 const query=new URLSearchParams({
  latitude:String(lat),longitude:String(lon),start:new Date(start).toISOString(),
  end:new Date(end).toISOString(),units:"meters"
 });
 const ctrl=new AbortController();
 const abort=()=>ctrl.abort();
 signal.addEventListener("abort",abort,{once:true});
 const timeout=setTimeout(abort,8000);
 try{
  const [timeline,extremes]=await Promise.all([
   fetchJson("/timeline",query,ctrl.signal),
   fetchJson("/extremes",query,ctrl.signal)
  ]);
  if(ctrl.signal.aborted)return null;
  const parsed=parseOpenWatersTide(timeline,extremes,now);
  if(parsed){
   cache.set(key,{at:now,forecast:parsed});
   if(cache.size>16)cache.delete(cache.keys().next().value!);
  }
  return parsed;
 }catch{return null;}
 finally{
  clearTimeout(timeout);
  signal.removeEventListener("abort",abort);
 }
}

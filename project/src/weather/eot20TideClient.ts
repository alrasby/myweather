/** Source-strict EOT20 global astronomical tide client for PyFES.
 * EOT20 is DGFI-TUM/SEANOE CC-BY-4.0, NOT AVISO FES2022b and NOT Open-Meteo
 * modelled total sea level. No endpoint, requests or credentials by default.
 */
import {parseFesPilotForecast, type FesPilotForecast} from "./fesTideContract.ts";

export type Eot20Forecast = Omit<FesPilotForecast, "source"> &
 Readonly<{source:"EOT20"; modelVersion:"EOT20-final"; citation:string; publiclyCalibrated:false}>;

const DOI="https://doi.org/10.17882/79489";
const HOURS=48;
const FIVE_MINUTES_MS=300_000;

export function eot20GatewayUrl(raw:string|undefined):string|null {
 if(!raw || raw.length>300) return null;
 try {
  const url=new URL(raw);
  if(url.protocol!=="https:" || url.username || url.password || url.search ||
     url.hash || url.port && url.port!=="443")return null;
  if(url.pathname!=="/" && url.pathname!=="/v1/tides")return null;
  url.pathname="/v1/tides";
  return url.toString();
 }catch{return null;}
}

export function isEot20GatewayEnabled():boolean {
 return import.meta.env.VITE_EOT20_TIDE_ENABLED==="1" &&
   !!eot20GatewayUrl(import.meta.env.VITE_EOT20_TIDE_GATEWAY);
}

export function parseEot20Forecast(raw:unknown,lat:number,lon:number,start:number,hours:number):Eot20Forecast|null {
 if(!raw || typeof raw!=="object" || Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(r.source!=="EOT20" || r.model_version!=="EOT20-final" ||
    r.license!=="CC-BY-4.0" || typeof r.citation!=="string" ||
    !r.citation.includes("10.5194/essd-13-3869-2021") ||
    r.method!=="PyFES Darwin global astronomical tide")return null;
 // Reuse the full FES scientific payload validator, not its *source*:
 // output retains EOT20 identity and cannot masquerade as a FES atlas.
 const checked=parseFesPilotForecast({...r,source:"FES2022b"},lat,lon,start,hours);
 if(!checked)return null;
 return {...checked,source:"EOT20",modelVersion:"EOT20-final",
   citation:r.citation,publiclyCalibrated:false};
}

export async function fetchEot20Forecast(
 lat:number,lon:number,now:number,signal:AbortSignal,
):Promise<Eot20Forecast|null>{
 if(!isEot20GatewayEnabled() || !Number.isFinite(now) ||
    !Number.isFinite(lat)||!Number.isFinite(lon) ||
    Math.abs(lat)>90||Math.abs(lon)>180||signal.aborted)return null;
 const origin=eot20GatewayUrl(import.meta.env.VITE_EOT20_TIDE_GATEWAY);
 if(!origin)return null;
 const start=Math.floor(now/FIVE_MINUTES_MS)*FIVE_MINUTES_MS - 6*3600000;
 const url=new URL(origin);
 url.searchParams.set("lat",String(lat));
 url.searchParams.set("lon",String(lon));
 url.searchParams.set("start",new Date(start).toISOString().replace(".000Z","Z"));
 url.searchParams.set("hours",String(HOURS));
 const timeout=new AbortController();
 const abort=()=>timeout.abort();
 signal.addEventListener("abort",abort,{once:true});
 const handle=setTimeout(abort,6_000);
 try{
  const response=await fetch(url.toString(),{signal:timeout.signal,cache:"no-store",
    headers:{Accept:"application/json"}});
  if(!response.ok)return null;
  const length=response.headers.get("content-length");
  if(length!==null && Number(length)>300000)return null;
  const body=await response.text();
  if(body.length>300000)return null;
  return parseEot20Forecast(JSON.parse(body),lat,lon,start,HOURS);
 }catch{return null;}
 finally{
  clearTimeout(handle);
  signal.removeEventListener("abort",abort);
 }
}

import type {Place} from "./types.ts";

/** Search arbitrary global WGS84 points without city names or network.
 * Preserve precise coordinates and never infer a country from them.
 */
export function parseCoordinatePlace(query:string):Place|null{
 const ascii=query.trim().replace(/[\u0660-\u0669\u06F0-\u06F9]/g, c=>{
  const v=c.charCodeAt(0);
  return String(v>=0x6F0?v-0x6F0:v-0x660);
 }).replace(/\u066B/g,".").replace(/\u2212/g,"-");
 const match=ascii.match(/^\s*([+-]?(?:\d{1,3}(?:\.\d{1,8})?|\.\d{1,8}))\s*[,;،]\s*([+-]?(?:\d{1,3}(?:\.\d{1,8})?|\.\d{1,8}))\s*$/);
 if(!match)return null;
 const lat=Number(match[1]),lon=Number(match[2]);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
 const north=Object.is(lat,-0)?0:lat;
 const east=Object.is(lon,-0)?0:lon;
 const label=north.toFixed(6)+", "+east.toFixed(6);
 return {
  id:"wgs84:"+north.toFixed(6)+":"+east.toFixed(6),
  name:label,nameEn:label,country:"",countryEn:"",admin:"",
  lat:north,lon:east,primary:false,
 };
}

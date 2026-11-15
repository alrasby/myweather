import type {Place} from "./types.ts";
/** Parse city-only Photon or GeoNames GeoJSON, preserving true source attribution. */
const TYPES=new Set(["city","town","village","hamlet","municipality","suburb","locality","district"]);
export function photonCities(json:unknown):Place[] {
 if(!json||typeof json!=="object"||!("features" in json)||!Array.isArray(json.features))return [];
 const matches:Place[]=[];
 for(const feature of json.features.slice(0,16)){
  if(!feature||typeof feature!=="object")continue;
  const props=feature.properties as Record<string,unknown>|undefined;
  const coords=feature.geometry?.coordinates as unknown;
  if(!props||!Array.isArray(coords)||coords.length<2||!TYPES.has(String(props.osm_value)))continue;
  const lon=Number(coords[0]),lat=Number(coords[1]);
  const name=String(props.name??props.city??props.town??props.village??"").trim();
  if(!name||name.length>150||!Number.isFinite(lon)||!Number.isFinite(lat)||
     Math.abs(lon)>180||Math.abs(lat)>90)continue;
  const geonames=typeof props.geonames_id==="number"&&
   Number.isSafeInteger(props.geonames_id)&&props.geonames_id>0;
  const id=geonames ? "geonames:"+props.geonames_id :
   typeof props.osm_id==="number"&&Number.isFinite(props.osm_id)
     ? "osm:"+String(props.osm_type??"")+":"+String(props.osm_id)
     : lat.toFixed(3)+","+lon.toFixed(3);
  matches.push({id,name,
    nameEn:geonames&&typeof props.name_en==="string"?props.name_en:undefined,
    country:String(props.country??"").slice(0,100),
    admin:String(props.state??props.county??"").slice(0,100),
    lat,lon,primary:false,source:geonames?"geonames":"osm-photon"});
 }
 return matches;
}

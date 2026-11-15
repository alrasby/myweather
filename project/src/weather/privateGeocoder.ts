/** Production geocoder configuration. Ship ONLY a public, TLS endpoint URL.
 * Never bake credentials into a mobile app or call komoot's demo by default.
 * A signed Android build fixes this endpoint at build time. */
const NOT_PRODUCTION=new Set(["photon.komoot.io","localhost","127.0.0.1","::1","0.0.0.0"]);
export function validatePrivateGeocoderEndpoint(value:unknown):string|null {
 if(typeof value!=="string"||value.length<17||value.length>280)return null;
 try{
  const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||
     u.port||NOT_PRODUCTION.has(u.hostname.toLowerCase())||
     /(^|\.)((local)|(localhost)|(internal)|(test)|(example))$/.test(u.hostname.toLowerCase())||
     /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)||
     !u.pathname.replace(/\/$/,"").endsWith("/api"))return null;
  return u.origin+u.pathname.replace(/\/$/,"");
 }catch{return null;}
}
export function privateGeocoderUrl(base:string,query:string,language:string):string {
 const endpoint=validatePrivateGeocoderEndpoint(base);
 if(!endpoint||Array.from(query.trim()).length<3||query.length>160)throw Error("invalid-geocoder-request");
 const url=new URL(endpoint);
 url.searchParams.set("q",query.trim());
 url.searchParams.set("lang",language.match(/^[a-z]{2,3}$/i)?language.toLowerCase():"en");
 url.searchParams.set("limit","6");
 url.searchParams.append("layer","city");
 url.searchParams.append("layer","locality");
 return url.toString();
}
/** Undefined means no production provider is provisioned: primary Open-Meteo
 * and bundled city search continue working; never silently use a public demo.
 */
export const configuredPrivateGeocoder=validatePrivateGeocoderEndpoint(
 import.meta.env?.VITE_MYWEATHER_GEOCODER_URL,
);

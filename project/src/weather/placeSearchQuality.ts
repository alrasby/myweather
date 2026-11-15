import type {Place} from "./types.ts";
import {normalizePlaceQuery} from "./places-index.ts";

/** Match Arabic variants, Latin accents, punctuation and spaces without a remote call. */
export const cityKey=(value:string):string=>normalizePlaceQuery(value)
  .normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]/gu,"");

/** A typo or an incomplete country qualifier must not make the whole city unfindable.
 * This fallback runs ONLY after the full query returns zero remote matches. */
export function relaxedCityQuery(value:string):string|null {
 const cleaned=normalizePlaceQuery(value).trim();
 const comma=cleaned.indexOf(",");
 if(comma>=0 && cleaned.slice(0,comma).trim().length>=3)return cleaned.slice(0,comma).trim();
 const units=Array.from(cleaned);
 return units.length>=4?units.slice(0,-1).join("").trim():null;
}
const matchScore=(value:string,q:string):number=>{
 const field=cityKey(value);
 if(!field||!q)return 0;
 if(field===q)return 120;
 if(field.startsWith(q))return 90;
 if(field.includes(q))return 42;
 const stem=q.slice(0,-1);
 if(q.length>=4&&stem.length>=3&&field.startsWith(stem))return 24;
 return 0;
};
export function mergeCityResults(query:string,local:readonly Place[],remote:readonly Place[],limit=12):Place[] {
 const q=cityKey(query);
 const rows:{place:Place;score:number;order:number}[]=[];
 for(const place of [...local,...remote]){
  if(!Number.isFinite(place.lat)||!Number.isFinite(place.lon)||
     Math.abs(place.lat)>90||Math.abs(place.lon)>180||!place.name.trim())continue;
  if(rows.some(r=>Math.abs(r.place.lat-place.lat)<0.018&&Math.abs(r.place.lon-place.lon)<0.018))continue;
  const names=[place.name,place.nameEn??"",...(place.aliases??[])];
  const score=Math.max(...names.map(name=>matchScore(name,q)));
  // Reject unrelated provider suggestions; only a name or verified alias
  // may qualify a city as a search result, not its country alone.
  if(score<=0)continue;
  rows.push({place,score,order:rows.length});
 }
 rows.sort((a,b)=>b.score-a.score||a.order-b.order);
 return rows.slice(0,limit).map(x=>x.place);
}

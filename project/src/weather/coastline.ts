/** Global sea shoreline eligibility from packaged CC0 Natural Earth 1:10m lines.
 * Independent of Open-Meteo's much coarser Marine numerical grid.
 * Does not claim metre-accurate coastline mapping or navigation accuracy. */
const BINS=180;
const HEADER=16+181*4;
const KM_PER_DEG=111.1950802335;
export const COASTAL_CITY_MAX_KM=12;
export const MAX_OFFSHORE_MODEL_CELL_KM=55;
export type ShorelineIndex={data:DataView;count:number};
export function parseShorelineIndex(bytes:ArrayBuffer):ShorelineIndex{
 const v=new DataView(bytes);
 if(bytes.byteLength<HEADER||
  String.fromCharCode(...new Uint8Array(bytes,0,4))!=="SHOR"||
  v.getUint32(4,true)!==1||v.getUint32(8,true)!==BINS)throw Error("shoreline-index-invalid");
 const count=v.getUint32(12,true);
 if(count<60000||bytes.byteLength!==HEADER+count*16)throw Error("shoreline-index-incomplete");
 let previous=0;
 for(let i=0;i<=BINS;i++){
  const k=v.getUint32(16+i*4,true);
  if(k<previous||k>count)throw Error("shoreline-index-corrupt");
  previous=k;
 }
 if(previous!==count)throw Error("shoreline-index-count");
 return {data:v,count};
}
function delta(lon:number,origin:number):number{
 return ((lon-origin+540)%360+360)%360-180;
}
export function shorelineDistanceKm(index:ShorelineIndex,lat:number,lon:number):number{
 if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon))return Infinity;
 const v=index.data,bin=Math.min(179,Math.max(0,Math.floor(lat+90)));
 const start=v.getUint32(16+bin*4,true);
 const end=v.getUint32(16+(bin+1)*4,true);
 const scale=Math.max(0.00001,Math.cos(lat*Math.PI/180))*KM_PER_DEG;
 let result=Infinity;
 for(let i=start;i<end;i++){
  const off=HEADER+i*16;
  const lon1=v.getInt32(off,true)/1e5,lat1=v.getInt32(off+4,true)/1e5;
  const lon2=v.getInt32(off+8,true)/1e5,lat2=v.getInt32(off+12,true)/1e5;
  const ax=delta(lon1,lon)*scale,ay=(lat1-lat)*KM_PER_DEG;
  const bx=ax+delta(lon2,lon1)*scale,by=(lat2-lat)*KM_PER_DEG;
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,(dx*dx+dy*dy)>0?-(ax*dx+ay*dy)/(dx*dx+dy*dy):0));
  const dist=Math.hypot(ax+t*dx,ay+t*dy);
  if(dist<result)result=dist;
 }
 return result;
}
export function isCoastalCity(index:ShorelineIndex,lat:number,lon:number):boolean{
 return shorelineDistanceKm(index,lat,lon)<=COASTAL_CITY_MAX_KM;
}
let cached:Promise<ShorelineIndex|null>|null=null;
async function fetchGlobalShoreline():Promise<ShorelineIndex|null>{
 try{
  const url=new URL("data/shoreline-v1.bin",document.baseURI);
  const res=await fetch(url.toString(),{cache:"force-cache"});
  if(!res.ok)return null;
  return parseShorelineIndex(await res.arrayBuffer());
 }catch{return null;}
}
/** Reuse once per app session; missing asset fails closed. */
export async function coastalDistanceKm(lat:number,lon:number):Promise<number>{
 if(!cached)cached=fetchGlobalShoreline();
 const index=await cached;
 return index?shorelineDistanceKm(index,lat,lon):Infinity;
}

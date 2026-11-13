/** Immutable source-backed ECMWF raster contract. No generated weather values. */
export const LAYERS=Object.freeze(['cloud_cover','precipitation','snowfall_water_equivalent']);
const SOURCE='https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs';
const pad=n=>String(n).padStart(2,'0');
const validDate=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
export function parseModelMetadata(m){
 if(!m||typeof m!=='object'||m.completed===false||!validDate(m.reference_time))throw new Error('model-metadata-invalid');
 if(m.variables&&(!Array.isArray(m.variables)||!LAYERS.every(x=>m.variables.includes(x))))throw new Error('model-variables-incomplete');
 const times=m.valid_times;
 if(!Array.isArray(times)||times.length===0||times.length>256||times.some((v,i)=>!validDate(v)||(i&&Date.parse(v)<=Date.parse(times[i-1]))))throw new Error('model-time-invalid');
 const d=new Date(m.reference_time);
 const runId=''+d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+'00Z';
 return Object.freeze({schemaVersion:1,model:'ecmwf_ifs',runId,referenceTime:d.toISOString(),validTimes:Object.freeze(times.slice(0,96)),layers:LAYERS,tileSize:256,maxNativeZoom:8,attribution:'Weather model: ECMWF IFS; spatial data distribution: Open-Meteo',source:SOURCE});
}
export function validTile(m,r){
 if(!m||m.runId!==r.runId||!LAYERS.includes(r.layer))return false;
 const {timeIndex,z,x,y}=r;
 if(![timeIndex,z,x,y].every(Number.isInteger)||timeIndex<0||timeIndex>=m.validTimes.length||z<0||z>m.maxNativeZoom)return false;
 const n=2**z;return x>=0&&x<n&&y>=0&&y<n;
}
export function tilePath(m,r){
 if(!validTile(m,r))throw new Error('tile-not-in-manifest');
 return r.runId+'/'+r.timeIndex+'/'+r.layer+'/'+r.z+'/'+r.x+'/'+r.y+'.png';
}
export function tileBounds({z,x,y}){
 const n=2**z,lat=v=>Math.atan(Math.sinh(Math.PI*(1-2*v/n)))*180/Math.PI;
 return {west:x/n*360-180,east:(x+1)/n*360-180,north:lat(y),south:lat(y+1)};
}
export function pinnedTileUrl(m,r){
 if(!validTile(m,r))throw new Error('tile-not-in-manifest');
 const at=new Date(m.validTimes[r.timeIndex]),d=new Date(m.referenceTime);
 const root=SOURCE+'/'+d.getUTCFullYear()+'/'+pad(d.getUTCMonth()+1)+'/'+pad(d.getUTCDate())+'/'+pad(d.getUTCHours())+'00Z';
 const file=at.getUTCFullYear()+'-'+pad(at.getUTCMonth()+1)+'-'+pad(at.getUTCDate())+'T'+pad(at.getUTCHours())+'00.om';
 const prev=new Date(m.validTimes[Math.max(0,r.timeIndex-1)]),next=new Date(m.validTimes[Math.min(m.validTimes.length-1,r.timeIndex+1)]);
 const hours=Math.max(1,(r.timeIndex?at-prev:next-at)/3600000);
 const q=new URLSearchParams({variable:r.layer,interpolation:'linear',color_blend:'true',tile_size:'256',delta_time_hours:String(hours)});
 return 'om://'+root+'/'+file+'?'+q+'/'+r.z+'/'+r.x+'/'+r.y;
}

/** Immutable source-backed ECMWF raster contract. No generated weather values. */
export const LAYERS=Object.freeze(['cloud_cover','precipitation','snowfall_water_equivalent']);
const SOURCE='https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs';
const pad=n=>String(n).padStart(2,'0');
/** Upstream latest.json may use minute-resolution UTC timestamps and a long forecast horizon.
 * Accept only unambiguous ISO UTC strings; normalize every published hour. */
function utcTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]00:00)?$/.test(value))return null;
 const iso=/(?:Z|[+-]00:00)$/.test(value)?value:value+'Z';
 const ms=Date.parse(iso);
 return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
export function parseModelMetadata(m){
 const ref=utcTime(m?.reference_time);
 if(!m||typeof m!=='object'||m.completed===false||!ref)throw new Error('model-metadata-invalid');
 if(m.variables&&(!Array.isArray(m.variables)||!LAYERS.every(x=>m.variables.includes(x))))throw new Error('model-variables-incomplete');
 const sourceTimes=m.valid_times;
 if(!Array.isArray(sourceTimes)||sourceTimes.length<1||sourceTimes.length>2048)throw new Error('model-time-invalid:length='+String(sourceTimes?.length??'missing'));
 // Model runs can publish well beyond our 96-hour playback budget; do not
 // reject a valid entire run just because the client only needs its first 96.
 const times=sourceTimes.slice(0,96).map(utcTime);
 if(times.some((v,i)=>!v||(i>0&&Date.parse(v)<=Date.parse(times[i-1]))))
  throw new Error('model-time-invalid:format='+String(sourceTimes[0]).slice(0,45)+':len='+sourceTimes.length);
 const d=new Date(ref);
 const runId=''+d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+'00Z';
 return Object.freeze({schemaVersion:1,model:'ecmwf_ifs',runId,referenceTime:ref,validTimes:Object.freeze(times),layers:LAYERS,tileSize:256,maxNativeZoom:8,attribution:'Weather model: ECMWF IFS; spatial data distribution: Open-Meteo',source:SOURCE});
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

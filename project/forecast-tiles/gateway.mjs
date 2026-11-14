/** Bounded immutable raster gateway. Never fabricates model pixels. */
import {createServer} from 'node:http';
import {mkdir,readFile,rename,writeFile,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {parseModelMetadata,tilePath,validTile} from './contracts.mjs';
import {validPng} from './pngIntegrity.mjs';
const META='https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json';
const fail=(status,msg)=>Object.assign(new Error(msg),{status});
export function createTileGateway({renderTile,cacheDir,fetchMetadata=async()=>{
 const r=await fetch(META,{signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new Error('model-metadata-http-'+r.status);return r.json();
},maxActive=2,maxWaiting=24,manifestTtlMs=300000,
retiredRunMs=6*60*60*1000,staleManifestMs=10*60*1000,now=()=>Date.now()}){
 if(typeof renderTile!=='function'||!cacheDir||!Number.isInteger(maxActive)||maxActive<1||!Number.isInteger(maxWaiting)||maxWaiting<0||!Number.isFinite(retiredRunMs)||retiredRunMs<0||!Number.isFinite(staleManifestMs)||staleManifestMs<0)throw new Error('invalid-tile-gateway');
 let active=0,manifest=null,due=0,refreshing=null,lastGoodAt=0;
 const retired=new Map();
 const prune=()=>{for(const [id,p] of retired)if(now()>=p.expires)retired.delete(id);};

 const cacheMs=[],renderMs=[];
 const record=(list,ms)=>{list.push(Math.round(ms));if(list.length>120)list.shift();};
 const p95=list=>list.length?[...list].sort((a,b)=>a-b)[Math.ceil(list.length*.95)-1]:null;
 const waiters=[],inflight=new Map(),stats={cacheHits:0,generated:0,failures:0,maxObservedActive:0};
 async function catalog(){
  if(manifest&&now()<due)return manifest;
  if(!refreshing)refreshing=Promise.resolve().then(fetchMetadata).then(parseModelMetadata).then(m=>{
   prune();
   // During a pinned-run rollover, keep at most one immediately preceding
   // real ECMWF run available to existing map sessions for a bounded grace.
   if(manifest&&manifest.runId!==m.runId&&retiredRunMs>0){
    retired.clear();
    retired.set(manifest.runId,{manifest,expires:now()+retiredRunMs});
   }
   manifest=m;lastGoodAt=now();due=now()+manifestTtlMs;return m;
  }).catch(error=>{
   const code=String(error?.cause?.code??error?.code??'').slice(0,60);
   console.warn('ECMWF_METADATA_QA_ERROR',String(error?.message??'unknown').slice(0,140),code);
   // Serve the last verified immutable run briefly while upstream metadata
   // is unavailable; never guess a new model run or its forecast values.
   if(manifest&&now()-lastGoodAt<=staleManifestMs){
    due=now()+Math.min(30000,staleManifestMs-(now()-lastGoodAt));
    return manifest;
   }
   throw error;
  }).finally(()=>{refreshing=null;});
  return refreshing;
 }
 async function limited(fn){
  if(active<maxActive&&waiters.length===0){active++;}
  else {
   if(waiters.length>=maxWaiting)throw fail(503,'tile-render-busy');
   // Existing active permit is transferred to this waiter on completion;
   // do NOT increment again or a racing request can exceed the hard budget.
   await new Promise(resolve=>waiters.push(resolve));
  }
  stats.maxObservedActive=Math.max(stats.maxObservedActive,active);
  try{return await fn();}
  finally{if(waiters.length)waiters.shift()();else active--;}
 }
 async function getTile(m,r){
  const relative=tilePath(m,r),full=join(cacheDir,relative);
  try{const began=performance.now(),b=await readFile(full);if(validPng(b)){stats.cacheHits++;record(cacheMs,performance.now()-began);return b;}}
  catch(e){if(e?.code!=='ENOENT')throw e;}
  if(inflight.has(relative))return inflight.get(relative);
  const task=limited(async()=>{
   try{const began=performance.now(),b=await readFile(full);if(validPng(b)){stats.cacheHits++;record(cacheMs,performance.now()-began);return b;}}
   catch(e){if(e?.code!=='ENOENT')throw e;}
   const began=performance.now(),b=await renderTile(m,r);
   if(!validPng(b))throw fail(502,'invalid-source-raster');
   record(renderMs,performance.now()-began);
   await mkdir(dirname(full),{recursive:true});
   const tmp=full+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';
   try{await writeFile(tmp,b,{flag:'wx'});await rename(tmp,full);}
   catch(e){await unlink(tmp).catch(()=>{});throw e;}
   stats.generated++;return b;
  }).finally(()=>inflight.delete(relative));
  inflight.set(relative,task);return task;
 }
 const server=createServer(async(req,res)=>{
  const send=(status,body,type='application/json',cache='no-store')=>{
   res.writeHead(status,{'Content-Type':type,'Cache-Control':cache,'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff'});
   res.end(body);
  };
  if(req.method!=='GET')return send(405,JSON.stringify({error:'method-not-allowed'}));
  const path=(req.url||'').split('?')[0];
  try{
   if(path==='/v1/health')return send(200,JSON.stringify({ready:!!manifest,...stats,active,waiting:waiters.length,retainedRuns:retired.size,cacheP95Ms:p95(cacheMs),renderP95Ms:p95(renderMs)}));
   if(path==='/v1/manifest.json')return send(200,JSON.stringify(await catalog()));
   const match=/^\/v1\/tiles\/([0-9]{8}T[0-9]{4}Z)\/(\d{1,3})\/(cloud_cover|precipitation|snowfall_water_equivalent)\/(\d{1,2})\/(\d{1,4})\/(\d{1,4})\.png$/.exec(path);
   if(!match)return send(404,JSON.stringify({error:'not-found'}));
   const m=await catalog();
   const r={runId:match[1],timeIndex:Number(match[2]),layer:match[3],z:Number(match[4]),x:Number(match[5]),y:Number(match[6])};
   prune();
   const older=retired.get(r.runId);
   const selected=validTile(m,r)?m:(older&&now()<older.expires&&validTile(older.manifest,r)?older.manifest:null);
   if(!selected)return send(404,JSON.stringify({error:'tile-run-unavailable'}));
   return send(200,await getTile(selected,r),'image/png','public, max-age=31536000, immutable');
  }catch(e){
   stats.failures++;
   const status=Number.isInteger(e?.status)?e.status:503;
   if(status>=500)res.setHeader('Retry-After','10');
   return send(status,JSON.stringify({error:status===503?'tile-service-unavailable':'tile-render-failed'}));
  }
 });
 return {server,catalog,stats};
}

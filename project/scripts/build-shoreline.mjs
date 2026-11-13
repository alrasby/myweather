/** Compile CC0 Natural Earth 1:10m ocean coastlines (plus minor islands)
 * into a compact, self-contained latitude-binned app asset.
 * Inputs pinned to https://github.com/martynafford/natural-earth-geojson
 * commit 0b9a6ceb0a7032713abd9460ac1e995a9c60cd1e.
 */
import {mkdir,stat,writeFile} from "node:fs/promises";
import {dirname,join} from "node:path";
import {createHash} from "node:crypto";
const PIN="0b9a6ceb0a7032713abd9460ac1e995a9c60cd1e";
const base="https://raw.githubusercontent.com/martynafford/natural-earth-geojson/"+PIN+"/10m/physical/";
const names=["ne_10m_coastline.json","ne_10m_minor_islands_coastline.json"];
const file=join(process.cwd(),"public/data/shoreline-v1.bin");
const bins=Array.from({length:180},()=>[]);
function add(a,b) {
 const [ax,ay]=a,[bx,by]=b;
 if(![ax,ay,bx,by].every(Number.isFinite)||Math.abs(ax)>180||Math.abs(bx)>180||Math.abs(ay)>90||Math.abs(by)>90)return;
 const points=[ax,ay,bx,by].map(v=>Math.round(v*1e5));
 const lo=Math.max(0,Math.floor(Math.min(ay,by)+90)-1);
 const hi=Math.min(179,Math.floor(Math.max(ay,by)+90)+1);
 for(let i=lo;i<=hi;i++)bins[i].push(...points);
}
async function source(name) {
 const r=await fetch(base+name,{signal:AbortSignal.timeout(90000)});
 if(!r.ok)throw new Error("source-http-"+r.status+"-"+name);
 const buffer=Buffer.from(await r.arrayBuffer());
 if(buffer.length<100000||buffer.length>30000000)throw new Error("source-size-invalid");
 console.log("SHORELINE_SOURCE",name,buffer.length,createHash("sha256").update(buffer).digest("hex"));
 const json=JSON.parse(buffer.toString("utf8"));
 if(json.type!=="FeatureCollection"||!Array.isArray(json.features))throw Error("source-json-invalid");
 for(const feature of json.features) {
  const g=feature.geometry;
  if(!g)continue;
  const lines=g.type==="LineString"?[g.coordinates]:g.type==="MultiLineString"?g.coordinates:[];
  for(const line of lines)if(Array.isArray(line))for(let i=1;i<line.length;i++)add(line[i-1],line[i]);
 }
}
async function main(){
 if(process.env.FORCE_SHORELINE_BUILD!=="1"&&(await stat(file).catch(()=>null))?.size>500000){
  console.log("SHORELINE_REUSE",file);return;
 }
 for(const name of names)await source(name);
 const count=bins.reduce((a,b)=>a+b.length/4,0);
 if(count<60000||count>4000000)throw Error("shoreline-count-invalid-"+count);
 const header=16+181*4;
 const out=Buffer.allocUnsafe(header+count*16);
 out.write("SHOR",0,"ascii");out.writeUInt32LE(1,4);out.writeUInt32LE(180,8);out.writeUInt32LE(count,12);
 let offset=0;
 for(let i=0;i<180;i++){
  out.writeUInt32LE(offset/4,16+i*4);
  for(const v of bins[i]){out.writeInt32LE(v,header+offset*4);offset++;}
 }
 out.writeUInt32LE(count,16+180*4);
 if(offset!==count*4)throw Error("shoreline-records-inconsistent");
 await mkdir(dirname(file),{recursive:true});
 await writeFile(file,out);
 console.log("SHORELINE_READY",JSON.stringify({bytes:out.length,records:count,sha256:createHash("sha256").update(out).digest("hex")}));
}
await main();

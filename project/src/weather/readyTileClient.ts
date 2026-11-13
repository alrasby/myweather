/** QA candidate: display immutable ready-made ECMWF PNGs, never decode .om on phone. */
import {planReadyTilePrefetch} from './readyTilePlan.ts';
import {TinyTileDemandModel, type TileSignals, type TileAction} from './tinyTileDemandModel.ts';
export type ReadyLayer='cloud_cover'|'precipitation'|'snowfall_water_equivalent';
const LAYERS:readonly ReadyLayer[]=['cloud_cover','precipitation','snowfall_water_equivalent'];
export type ReadyManifest={schemaVersion:1;model:'ecmwf_ifs';runId:string;referenceTime:string;validTimes:readonly string[];layers:readonly ReadyLayer[];tileSize:256;maxNativeZoom:number};
export function parseReadyManifest(raw:unknown):ReadyManifest{
 if(!raw||typeof raw!=='object')throw new Error('ready-manifest-invalid');
 const m=raw as Record<string,unknown>;
 if(m.schemaVersion!==1||m.model!=='ecmwf_ifs'||typeof m.runId!=='string'|| !/^\d{8}T\d{4}Z$/.test(m.runId)||typeof m.referenceTime!=='string'||!Number.isFinite(Date.parse(m.referenceTime)))throw new Error('ready-manifest-invalid');
 const ref=new Date(m.referenceTime as string);
 const pad=(n:number)=>String(n).padStart(2,'0');
 const id=''+ref.getUTCFullYear()+pad(ref.getUTCMonth()+1)+pad(ref.getUTCDate())+'T'+pad(ref.getUTCHours())+'00Z';
 if(m.runId!==id)throw new Error('ready-run-id-mismatch');
 const layers=m.layers;
 if(!Array.isArray(layers)||layers.length!==3||!LAYERS.every(x=>layers.includes(x)))throw new Error('ready-manifest-incomplete');
 const times=m.validTimes;
 if(!Array.isArray(times)||!times.length||times.length>96||times.some((t,i)=>typeof t!=='string'||!Number.isFinite(Date.parse(t))||i>0&&Date.parse(t)<=Date.parse(times[i-1])))throw new Error('ready-manifest-time-invalid');
 if(m.tileSize!==256||!Number.isInteger(m.maxNativeZoom)||(m.maxNativeZoom as number)<0||(m.maxNativeZoom as number)>8)throw new Error('ready-manifest-tile-invalid');
 return m as ReadyManifest;
}
export function readyTilesBase(input:string):string{
 const url=new URL(input);
 if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('unsafe-ready-tile-origin');
 return url.toString().replace(/\/$/,'');
}
export function readyTileUrl(base:string,m:ReadyManifest,r:{hour:number;layer:ReadyLayer;z:number;x:number;y:number}):string{
 if(!LAYERS.includes(r.layer)||!Number.isInteger(r.hour)||r.hour<0||r.hour>=m.validTimes.length||![r.z,r.x,r.y].every(Number.isInteger)||r.z<0||r.z>m.maxNativeZoom||r.x<0||r.y<0||r.x>=2**r.z||r.y>=2**r.z)throw new Error('invalid-ready-tile');
 return readyTilesBase(base)+'/v1/tiles/'+m.runId+'/'+r.hour+'/'+r.layer+'/'+r.z+'/'+r.x+'/'+r.y+'.png';
}
type Layer={on:(name:string,cb:()=>void)=>Layer;addTo:(map:MapLike)=>Layer;setOpacity:(opacity:number)=>Layer;getContainer?:()=>{style:{transition:string}}|null;remove:()=>void};
type MapLike={getCenter:()=>{lat:number;lng:number};getZoom:()=>number};
type LeafletLike={tileLayer:(url:string,options:Record<string,unknown>)=>Layer};
type Frame={hour:number;layers:Layer[];loaded:boolean[];counts:number[];timer:ReturnType<typeof setTimeout>|null;failed:boolean};
export class ReadyTileClient{
 private current:Frame|null=null;
 private incoming:Frame|null=null;
 private retiring:Frame|null=null;
 private oldTimer:ReturnType<typeof setTimeout>|null=null;
 private destroyed=false;
 private failedUntil=0;
 private readonly intelligence=new TinyTileDemandModel();
 private previous: {x:number;y:number;z:number;hour:number;signals:TileSignals}|null=null;
 get intelligenceSamples():number{return this.intelligence.observations;}
 private prefetched=new Map<string,HTMLImageElement>();
 private readonly L:LeafletLike;
 private readonly map:MapLike;
 private readonly base:string;
 private readonly onReady:(time:string)=>void;
 private readonly onMiss:()=>void;
 private readonly prefetchImages:(url:string)=>HTMLImageElement;
 readonly manifest:ReadyManifest;
 constructor(L:LeafletLike,map:MapLike,base:string,manifest:ReadyManifest,onReady:(time:string)=>void,onMiss:()=>void,
  prefetchImages:(url:string)=>HTMLImageElement=url=>{const img=new Image();img.decoding='async';img.src=url;return img;}){
  this.L=L;this.map=map;this.onReady=onReady;this.onMiss=onMiss;this.prefetchImages=prefetchImages;
  this.base=readyTilesBase(base);this.manifest=parseReadyManifest(manifest);
 }
 get displayedTime():string|null{return this.current?this.manifest.validTimes[this.current.hour]??null:null;}
 get displayedHour():number|null{return this.current?.hour??null;}
 isReady(hour:number):boolean{return this.current?.hour===hour||!!this.incoming&&this.incoming.hour===hour&&this.incoming.loaded.every(Boolean)&&!this.incoming.failed;}
 private disposeFrame(f:Frame|null){if(!f)return;if(f.timer)clearTimeout(f.timer);for(const layer of f.layers)layer.remove();}
 private clearPredictor(){for(const img of this.prefetched.values())img.src='';this.prefetched.clear();}
 /** Publish only after all three valid real-data image layers finish. */
 show(hour:number){
  if(this.destroyed||Date.now()<this.failedUntil||!Number.isInteger(hour)||hour<0||hour>=this.manifest.validTimes.length)return;
  if(this.current?.hour===hour||this.incoming?.hour===hour)return;
  this.disposeFrame(this.incoming);this.incoming=null;
  if(this.retiring){if(this.oldTimer)clearTimeout(this.oldTimer);this.disposeFrame(this.retiring);this.retiring=null;this.oldTimer=null;}
  const frame:Frame={hour,layers:[],loaded:[false,false,false],counts:[0,0,0],timer:null,failed:false};
  this.incoming=frame;
  const fail=()=>{
   if(this.destroyed)return;
   // A new viewport can fail AFTER the previously complete layer was shown.
   // Do not retain invalid ECMWF tiles or overlay them on a different fallback.
   if(this.current===frame){
    this.failedUntil=Date.now()+12000;this.disposeFrame(frame);this.current=null;this.onMiss();return;
   }
   if(this.incoming!==frame)return;
   frame.failed=true;this.failedUntil=Date.now()+12000;
   this.disposeFrame(frame);this.incoming=null;
   if(!this.current)this.onMiss();
  };
  const complete=()=>{
   if(this.destroyed||this.incoming!==frame||frame.failed||!frame.loaded.every(Boolean)||frame.counts.some(x=>x===0))return;
   if(frame.timer)clearTimeout(frame.timer);frame.timer=null;
   const old=this.current;this.current=frame;this.incoming=null;
   // Only adjacent hours of the SAME pinned ECMWF run may cross-fade.
   // A large timeline jump must never briefly blend unrelated forecast times.
   const adjacent=!!old&&Math.abs(old.hour-hour)===1;
   frame.layers.forEach(layer=>{const element=layer.getContainer?.();if(element&&adjacent)element.style.transition='opacity 240ms ease-out';layer.setOpacity(1);});
   this.onReady(this.manifest.validTimes[hour]!);
   if(old&&adjacent){this.retiring=old;this.oldTimer=setTimeout(()=>{this.disposeFrame(old);this.retiring=null;this.oldTimer=null;},280);}
   else if(old)this.disposeFrame(old);
  };
  for(const [index,variable] of LAYERS.entries()){
   const pane=index===0?'wx-clouds':'wx-model';
   const first=readyTileUrl(this.base,this.manifest,{hour,layer:variable,z:0,x:0,y:0});
   const template=first.replace(/\/0\/0\/0\.png$/,'/{z}/{x}/{y}.png');
   const layer=this.L.tileLayer(template,{pane,opacity:0,tileSize:256,maxNativeZoom:this.manifest.maxNativeZoom,maxZoom:16,keepBuffer:2,updateWhenIdle:true,updateWhenZooming:false});
   layer.on('tileload',()=>{if(this.incoming===frame)frame.counts[index]++;});
   layer.on('load',()=>{if(this.incoming===frame){frame.loaded[index]=true;complete();}});
   layer.on('tileerror',fail);frame.layers.push(layer);
  }
  frame.timer=setTimeout(fail,12000);
  for(const layer of frame.layers)layer.addTo(this.map);
 }
 /** Forecast-demand predictor warms authentic next-hour PNG URLs only. */
 prefetch(hour:number,movingX:number,movingY:number,playing:boolean,dataSaver:boolean){
  if(this.destroyed||dataSaver||hour<0||hour>=this.manifest.validTimes.length){this.clearPredictor();return;}
  const center=this.map.getCenter(),z=Math.max(0,Math.min(this.manifest.maxNativeZoom,Math.floor(this.map.getZoom()))),n=2**z;
  const x=Math.floor((center.lng+180)/360*n),lat=Math.max(-85.05,Math.min(85.05,center.lat))*Math.PI/180;
  const y=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n);
  const signals:TileSignals={movingX,movingY,playing};
  const prev=this.previous;
  if(prev&&prev.z===z){
   // Only relative *tile* motion; no coordinates or history stored.
   const dx=((x-prev.x+n+n/2)%n)-n/2,dy=y-prev.y;
   let actual:TileAction='still';
   if(playing&&hour>prev.hour)actual='nextHour';
   else if(Math.abs(dx)>=Math.abs(dy)&&dx!==0)actual=dx>0?'east':'west';
   else if(dy!==0)actual=dy>0?'south':'north';
   this.intelligence.observe(prev.signals,actual);
  }
  this.previous={x,y,z,hour,signals};
  const suggestion=this.intelligence.predict(signals);
  if(suggestion==='east')movingX=1;
  else if(suggestion==='west')movingX=-1;
  else if(suggestion==='south')movingY=1;
  else if(suggestion==='north')movingY=-1;
  else if(suggestion==='still')movingX=movingY=0;
  const wanted=new Set<string>();
  for(const p of planReadyTilePrefetch({z,x,y,hour,count:this.manifest.validTimes.length,movingX,movingY,playing,dataSaver})){
   const url=readyTileUrl(this.base,this.manifest,{hour:p.hour,layer:p.layer,z:p.z,x:p.x,y:p.y});
   wanted.add(url);
   if(!this.prefetched.has(url))this.prefetched.set(url,this.prefetchImages(url));
  }
  // Keep shared work alive through nearby gestures; cancel obsolete requests.
  for(const [url,image] of this.prefetched)if(!wanted.has(url)){image.src='';this.prefetched.delete(url);}

 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.intelligence.reset();this.previous=null;this.clearPredictor();if(this.oldTimer)clearTimeout(this.oldTimer);this.oldTimer=null;this.disposeFrame(this.retiring);this.retiring=null;this.disposeFrame(this.incoming);this.disposeFrame(this.current);this.current=null;this.incoming=null;}
}

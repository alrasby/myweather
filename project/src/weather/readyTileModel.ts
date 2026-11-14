/** Optional source-backed ECMWF image pilot.
 * No heavy client-side OM engine is attached unless the probe fails.
 * On any pilot failure the original ModelField takes over exactly once. */
import type {Map as LeafletMap} from "leaflet";
import {ModelField, type WeatherDiagnosticMode, type WeatherModelDiagnostics} from "./modelField";
import {ReadyTileClient, parseReadyManifest, type ReadyManifest} from "./readyTileClient";
import {pilotManifestIsUsable} from "./readyTilePilotConfig";

type Mode="probing"|"ready"|"legacy";
export class ReadyTileModel extends ModelField {
 private readonly origin:string;
 private mode:Mode="probing";
 private client:ReadyTileClient|null=null;
 private manifest:ReadyManifest|null=null;
 private mapPilot:LeafletMap|null=null;
 private L:unknown=null;
 private controller:AbortController|null=null;
 private probe:Promise<void>=Promise.resolve();
 private generation=0;
 private visiblePilot=false;
 private livePilot=false;
 private requestedMs=0;
 private playbackPilot=false;
 private dataSaverPilot=false;
 private sourceFallbackPilot=false;
 private diagnosticPilot:WeatherDiagnosticMode="all";
 private lastPrefetch=0;
 private pilotError:string|null=null;
 private moveHandler:(()=>void)|null=null;
 constructor(origin:string,dataSaver=false){super();this.origin=origin;this.dataSaverPilot=dataSaver;}
 setDataSaver(enabled:boolean){this.dataSaverPilot=enabled;}
 private hourAt(timeMs:number):number|null{
  const times=this.manifest?.validTimes;
  if(!times?.length||!Number.isFinite(timeMs)||
    timeMs>Date.parse(times[times.length-1]!))return null;
  let i=0;
  while(i+1<times.length&&Date.parse(times[i+1]!)<=timeMs)i++;
  return i;
 }
 private fallback(){
  if(this.mode==="legacy")return;
  this.controller?.abort();this.controller=null;
  this.client?.destroy();this.client=null;
  this.livePilot=false;
  this.mode="legacy";
  this.detachMove();
  const map=this.mapPilot, L=this.L;
  if(!map||!L)return;
  // Restore the unmodified official model only after opting out of pilot.
  super.attach(L,map);
  super.setDiagnosticMode(this.diagnosticPilot);
  super.setPlaybackActive(this.playbackPilot);
  super.setVisible(this.visiblePilot);
  if(this.visiblePilot&&this.requestedMs)super.sync(this.requestedMs);
  this.onMiss?.();
 }
 private detachMove(){
  if(this.mapPilot&&this.moveHandler)this.mapPilot.off("moveend",this.moveHandler);
  this.moveHandler=null;
 }
 private warmTiles(){
  const map=this.mapPilot,client=this.client;
  if(!this.visiblePilot||this.mode!=="ready"||!map||!client)return;
  const at=performance.now();
  if(at-this.lastPrefetch<350)return;
  this.lastPrefetch=at;
  const hour=this.hourAt(this.requestedMs);
  if(hour==null)return;
  client.prefetch(hour,0,0,this.playbackPilot,this.dataSaverPilot);
 }
 attach(L:unknown,map:LeafletMap){
  // The pilot bypasses ModelField.attach: create the map panes previously
  // owned by the official engine, before any ready PNG image layer is added.
  for(const [name,z] of [["wx-clouds","245"],["wx-model","260"]] as const){
   const pane=map.getPane(name)??map.createPane(name);
   pane.style.zIndex=z;
   pane.style.pointerEvents="none";
  }
  this.generation++;
  this.controller?.abort();
  this.client?.destroy();
  this.detachMove();
  this.mode="probing";this.livePilot=false;this.manifest=null;
  this.client=null;this.L=L;this.mapPilot=map;this.pilotError=null;
  this.lastPrefetch=0;
  const generation=this.generation;
  const controller=new AbortController();
  this.controller=controller;
  const timeout=setTimeout(()=>controller.abort(),5000);
  this.probe=fetch(this.origin+"/v1/manifest.json",{
   signal:controller.signal,cache:"no-store"
  }).then(async response=>{
   if(!response.ok)throw new Error("pilot-manifest-http-"+response.status);
   return parseReadyManifest(await response.json());
  }).then(manifest=>{
   if(generation!==this.generation||controller.signal.aborted)return;
   if(!pilotManifestIsUsable(manifest,Date.now()))throw new Error("pilot-run-stale");
   this.manifest=manifest;
   this.client=new ReadyTileClient(
    L as ConstructorParameters<typeof ReadyTileClient>[0],
    map as unknown as ConstructorParameters<typeof ReadyTileClient>[1],
    this.origin,manifest,
    ()=>{if(this.mode!=="ready"||!this.visiblePilot)return;
      this.livePilot=true;this.onLive?.();},
    ()=>{if(this.mode==="ready")this.fallback();}
   );
   this.mode="ready";
   this.moveHandler=()=>{
    if(this.mode!=="ready"||!this.visiblePilot)return;
    this.warmTiles();
   };
   map.on("moveend",this.moveHandler);
   if(this.visiblePilot)this.sync(this.requestedMs||Date.now());
  }).catch(error=>{
   if(generation!==this.generation)return;
   this.pilotError=error instanceof Error?error.message.slice(0,100):"pilot-unavailable";
   this.fallback();
  }).finally(()=>clearTimeout(timeout));
 }
 whenReady():Promise<number>{
  return this.probe.then(()=>this.mode==="ready"?(this.manifest?.validTimes.length??0):super.whenReady());
 }
 setVisible(on:boolean){
  this.visiblePilot=on;
  if(this.mode==="legacy"){super.setVisible(on);return;}
  if(!on){
   this.livePilot=false;
   this.client?.destroy();
   this.client=null;
   this.onMiss?.();
  }else if(this.mode==="ready"&&this.manifest&&this.mapPilot&&this.L){
   if(!this.client){
    const manifest=this.manifest;
    this.client=new ReadyTileClient(this.L as ConstructorParameters<typeof ReadyTileClient>[0],
      this.mapPilot as unknown as ConstructorParameters<typeof ReadyTileClient>[1],this.origin,manifest,
      ()=>{if(this.mode==="ready"&&this.visiblePilot){this.livePilot=true;this.onLive?.();}},
      ()=>{if(this.mode==="ready")this.fallback();});
   }
   this.sync(this.requestedMs||Date.now());
  }
 }
 sync(ms:number){
  this.requestedMs=ms;
  if(this.mode==="legacy"){super.sync(ms);return;}
  if(this.mode!=="ready"||!this.visiblePilot||!this.client)return;
  const hour=this.hourAt(ms);
  if(hour==null){this.fallback();return;}
  this.client.show(hour);
  this.warmTiles();
 }
 canAdvanceTo(ms:number):boolean{
  if(this.mode==="legacy")return super.canAdvanceTo(ms);
  if(this.mode!=="ready"||!this.visiblePilot||!this.client)return true;
  const hour=this.hourAt(ms);
  if(hour==null)return true;
  if(this.client.isReady(hour))return true;
  // Proactively mount the target hour while playback waits at its boundary.
  this.client.show(hour);
  return this.sourceFallbackPilot;
 }
 setPlaybackActive(active:boolean){
  this.playbackPilot=active;
  if(this.mode==="legacy")super.setPlaybackActive(active);
 }
 setSourceBackedFallback(available:boolean){
  this.sourceFallbackPilot=available;
  if(this.mode==="legacy")super.setSourceBackedFallback(available);
 }
 isSpatialVisible():boolean{
  return this.mode==="legacy"?super.isSpatialVisible():this.mode==="ready"&&this.visiblePilot&&this.livePilot;
 }
 setDiagnosticMode(mode:WeatherDiagnosticMode){
  this.diagnosticPilot=mode;
  if(this.mode==="legacy")super.setDiagnosticMode(mode);
 }
 diagnostics():WeatherModelDiagnostics{
  if(this.mode==="legacy")return {...super.diagnostics(),backend:"om-on-device",
    pilotFailure:this.pilotError};
  const baseline=super.diagnostics(),manifest=this.manifest;
  const displayed=this.client?.displayedHour??null;
  const requested=this.hourAt(this.requestedMs);
  return {...baseline,backend:this.mode==="ready"?"ready-tiles":"pilot-probing",
   pilotFailure:this.pilotError,source:this.livePilot?"spatial":"fallback",
   frame:requested??0,requestedFrame:requested??0,displayedFrame:displayed,
   requestedValidTime:requested!=null?(manifest?.validTimes[requested]??null):null,
   displayedValidTime:this.livePilot?this.client?.displayedTime??null:null,
   modelRunPinned:!!manifest,
   modelRunReferenceTime:manifest?.referenceTime??null,
   metadataAvailable:!!manifest,
   loaded:[this.livePilot,this.livePilot,this.livePilot],
   visibleOpacity:this.livePilot?1:0,
   error:this.pilotError,
   tinyModelObservations:this.client?.intelligenceSamples??0};
 }
 dispose(){
  this.generation++;
  this.controller?.abort();this.controller=null;
  this.detachMove();this.client?.destroy();this.client=null;
  this.mapPilot=null;this.L=null;this.manifest=null;
  this.mode="probing";this.visiblePilot=false;this.livePilot=false;
  this.pilotError=null;this.requestedMs=0;
  super.dispose();
 }
}

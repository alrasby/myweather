/** Dedicated off-device Chromium producer; only source-backed .om data may become raster pixels. */
import {defaultOmProtocolSettings,omProtocol,updateCurrentBounds} from '@openmeteo/weather-map-layer';
import {parseModelMetadata,pinnedTileUrl,validTile} from './contracts.mjs';
import {metaTileBounds} from './metatiles.mjs';
const RAIN={type:'breakpoint' as const,unit:'mm/h',breakpoints:[.12,.4,.9,1.8,3.5,7,12,20],colors:[[176,214,248,0],[72,158,236,.65],[22,104,214,.83],[14,158,86,.88],[190,206,22,.91],[255,176,0,.94],[224,58,26,.96],[132,34,176,.97]]};
const SNOW={type:'breakpoint' as const,unit:'mm/h',breakpoints:[.08,.25,.7,1.6],colors:[[213,229,249,0],[154,204,251,.74],[226,243,255,.90],[249,253,255,.95]]};
const CLOUD={type:'breakpoint' as const,unit:'%',breakpoints:[55,70,82,90,96,100],colors:[[255,255,255,0],[255,255,255,0],[249,252,255,.11],[248,251,255,.31],[244,249,255,.54],[244,249,255,.68]]};
const config={...defaultOmProtocolSettings,colorScales:{...defaultOmProtocolSettings.colorScales,cloud_cover:CLOUD,precipitation:RAIN,snowfall_water_equivalent:SNOW},maxStatesWithData:6};
type Request={runId:string;timeIndex:number;layer:'cloud_cover'|'precipitation'|'snowfall_water_equivalent';z:number;x:number;y:number};
async function generate(data:{referenceTime:string;validTimes:string[]},request:Request):Promise<number[]>{
 const manifest=parseModelMetadata({reference_time:data.referenceTime,valid_times:data.validTimes});
 if(!validTile(manifest,request))throw new Error('render-request-invalid');
 // Reuse the SAME upstream decoded window for neighboring real tiles.
 updateCurrentBounds(metaTileBounds(request));
 const ctrl=new AbortController();
 const result=await omProtocol({url:pinnedTileUrl(manifest,request),type:'image'},ctrl,config);
 const bitmap=result.data;
 if(!(bitmap instanceof ImageBitmap))throw new Error('source-did-not-produce-bitmap');
 try{
  const canvas=new OffscreenCanvas(manifest.tileSize,manifest.tileSize),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('raster-canvas-unavailable');
  ctx.drawImage(bitmap,0,0);
  const blob=await canvas.convertToBlob({type:'image/png'});
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
 }finally{bitmap.close();}
}
(window as typeof window & {__renderReadyTile?:typeof generate}).__renderReadyTile=generate;

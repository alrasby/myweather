/** Opt-in only, never enabled in the default or shipping weather map. */
import {readyTilesBase} from "./readyTileClient.ts";
type ReadonlyStore=Pick<Storage,"getItem">;
export const READY_TILES_PILOT_ENABLED="myweather.readyTiles.enabled";
export const READY_TILES_PILOT_ORIGIN="myweather.readyTiles.origin";
export function readReadyTilePilotOrigin(store:ReadonlyStore|null|undefined):string|null{
 try{
  if(!store||store.getItem(READY_TILES_PILOT_ENABLED)!=="1")return null;
  const input=store.getItem(READY_TILES_PILOT_ORIGIN);
  if(!input||input.length>320)return null;
  const base=readyTilesBase(input.trim());
  // The Android app must never fetch a remote forecast/coordinates over HTTP.
  return new URL(base).protocol==="https:"?base:null;
 }catch{return null;}
}
/** Reject stale and future-dated runs; don't accept a service that shows an
 * authentic image under a misleading clock label. */
export function pilotManifestIsUsable(manifest:{referenceTime:string;validTimes:readonly string[]},
 nowMs:number):boolean{
 if(!Number.isFinite(nowMs)||!manifest.validTimes.length)return false;
 const run=Date.parse(manifest.referenceTime);
 const last=Date.parse(manifest.validTimes[manifest.validTimes.length-1]!);
 return Number.isFinite(run)&&Number.isFinite(last)&&
   run<=nowMs+3600000&&run>=nowMs-72*3600000&&last>=nowMs+3600000;
}

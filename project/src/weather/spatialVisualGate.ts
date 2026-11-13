/** Visual readiness is a deterministic safety gate, not synthetic weather.
 * A tile patch must not show over a different frame or model product. */
import {canStageSpatialRefresh,type SpatialRasterView} from "./spatialTileReveal.ts";
export type SpatialRevealDecision = "stage"|"hide-incomplete"|"initial";
export function spatialRevealDecision(
  hasShownForecast:boolean,
  completed:SpatialRasterView|null,
  incoming:SpatialRasterView,
):SpatialRevealDecision {
  if(!hasShownForecast)return "initial";
  return canStageSpatialRefresh(completed,incoming)?"stage":"hide-incomplete";
}
/** Ready only when every real model layer is settled in the SAME viewport.
 * Dry transparent tiles are valid; missing/error tiles are not. */
export function visualViewportReady(
  loaded:readonly boolean[],counts:readonly number[],errors:readonly number[],
):boolean {
  return loaded.length===3&&counts.length===3&&errors.length===3&&
    loaded.every(Boolean)&&counts.every(n=>Number.isInteger(n)&&n>0)&&
    errors.every(n=>n===0);
}

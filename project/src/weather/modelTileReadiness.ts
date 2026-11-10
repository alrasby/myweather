/** Spatial ECMWF layers are cloud cover, precipitation and snowfall.
 * A transparent rain/snow tile can be a valid dry forecast; transparency is NOT
 * evidence of a failed data request. */
export const SPATIAL_LAYER_COUNT = 3;

/** A full weather-model frame can replace the coarse fallback only when all
 * weather layers have finished loading without errors. */
export function modelTileFrameReady(
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
  deliveredTiles?: readonly number[],
): boolean {
  return loaded.length === SPATIAL_LAYER_COUNT &&
    loaded.every((ready) => ready === true) &&
    errored.size === 0 &&
    (!deliveredTiles || (deliveredTiles.length === SPATIAL_LAYER_COUNT &&
      deliveredTiles.every((count) => count > 0)));
}

/** Metadata may omit a variable list on older compatible endpoints.
 * When a list is supplied, a complete spatial frame requires all three.
 * Never replace a snowfall layer using a model run missing snow data. */
export function modelVariablesReady(variables?: readonly string[]): boolean {
  if (!variables) return true;
  return ["cloud_cover", "precipitation", "snowfall_water_equivalent"].every(
    (variable) => variables.includes(variable),
  );
}

/** Keep an already-painted spatial frame on screen while Leaflet fetches tiles
 * for a new viewport. Its previous tiles remain buffered by Leaflet; clearing
 * the entire frame at the first loading event exposes the coarse 72x36 global
 * fallback on every pan, producing the observed gelatinous rain/cloud shapes.
 *
 * For a first-ever frame all three queues must complete, and after a refresh
 * fully settles we accept only a complete error-free set. */
export function spatialFrameReadyDuringRefresh(
  wasReady: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
  deliveredTiles: readonly number[],
): boolean {
  if (wasReady && loaded.some((isLoaded) => !isLoaded)) return true;
  return modelTileFrameReady(loaded, errored, deliveredTiles);
}

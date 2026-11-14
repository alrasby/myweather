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

/** Only a COMPLETE current geographic tile set may replace the real fallback.
 * A previous frame.ready=true plus historical tileCounts cannot prove that
 * Leaflet's new viewport is covered. On mobile with keepBuffer=0, Leaflet
 * drops old tiles and progressively inserts fresh ones, which otherwise
 * exposes half-screen seams while reporting ECMWF "spatial/ready".
 *
 * The current-coverage proof checks genuine, previously tileload-certified
 * canvases at the actual Leaflet tile zoom, including cached canvases that
 * are reused without firing new load events. No fake weather is accepted.
 */
export function spatialFrameReadyDuringRefresh(
  wasReady: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
  deliveredTiles: readonly number[],
  currentCoverageCertified: boolean,
): boolean {
  if (!currentCoverageCertified || errored.size > 0) return false;
  if (wasReady && loaded.some((isLoaded) => !isLoaded)) {
    // This can retain the previous image ONLY when every currently visible
    // tile is independently certified, not merely when old counters are >0.
    return true;
  }
  return modelTileFrameReady(loaded, errored, deliveredTiles);
}

/** Show a real ECMWF cloud layer as soon as its complete viewport arrives,
 * without waiting for separate precipitation/snowfall decoders. Rain and snow
 * remain hidden until their own queues complete; no invented forecast data. */
export function spatialCloudPreviewReady(
  wasVisible: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
  deliveredTiles: readonly number[],
): boolean {
  if (loaded.length !== SPATIAL_LAYER_COUNT || deliveredTiles.length !== SPATIAL_LAYER_COUNT ||
      errored.has(0) || deliveredTiles[0]! <= 0) return false;
  return loaded[0] === true || (wasVisible && !loaded[0]);
}

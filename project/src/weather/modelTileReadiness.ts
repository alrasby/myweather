/** Spatial ECMWF layers are cloud cover, precipitation and snowfall.
 * A transparent rain/snow tile can be a valid dry forecast; transparency is NOT
 * evidence of a failed data request. */
export const SPATIAL_LAYER_COUNT = 3;

/** A full weather-model frame can replace the coarse fallback only when all
 * weather layers have finished loading without errors. */
export function modelTileFrameReady(
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
): boolean {
  return loaded.length === SPATIAL_LAYER_COUNT &&
    loaded.every((ready) => ready === true) &&
    errored.size === 0;
}

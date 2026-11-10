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

/** Metadata may omit a variable list on older compatible endpoints.
 * When a list is supplied, a complete spatial frame requires all three.
 * Never replace a snowfall layer using a model run missing snow data. */
export function modelVariablesReady(variables?: readonly string[]): boolean {
  if (!variables) return true;
  return ["cloud_cover", "precipitation", "snowfall_water_equivalent"].every(
    (variable) => variables.includes(variable),
  );
}

/** The three model tile layers: cloud, precipitation, snowfall. */
export function isPrecipitationTile(index: number): boolean {
  return index === 1 || index === 2;
}

/** A regional weather-model frame may replace the global fallback only
 * after rain or snow has actual data and all current tile queues finish. */
export function modelTileFrameReady(
  hasPrecipitationInk: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
): boolean {
  return hasPrecipitationInk && loaded.length === 3 && loaded.every(Boolean) && errored.size === 0;
}

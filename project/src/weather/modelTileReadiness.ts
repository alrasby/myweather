/** A regional weather-model frame may replace the global fallback only
 * after all three current cloud, rain and snow tile queues have finished. */
export function modelTileFrameReady(
  hasInk: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
): boolean {
  return hasInk && loaded.length === 3 && loaded.every(Boolean) && errored.size === 0;
}

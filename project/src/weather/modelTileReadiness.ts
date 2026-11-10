/** Two spatial weather tiles: precipitation then snowfall. Cloud cover is
 * drawn continuously by the global grid rather than tiled opaque sheets. */
export function isPrecipitationTile(index: number): boolean {
  return index === 0 || index === 1;
}

/** Regional precipitation/snow may overlay the continuous global field only
 * after a rain or snow tile has actual data and both tile queues finish. */
export function modelTileFrameReady(
  hasPrecipitationInk: boolean,
  loaded: readonly boolean[],
  errored: ReadonlySet<number>,
): boolean {
  return hasPrecipitationInk && loaded.length === 2 && loaded.every(Boolean) && errored.size === 0;
}

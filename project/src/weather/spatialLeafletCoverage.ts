/** Recover ONLY genuine, already-delivered raster tiles reused by Leaflet.
 *
 * A moveend invalidates ECMWF frame readiness while Leaflet may satisfy
 * the entire new viewport from its EXISTING canvas tile cache. Such a move
 * emits no new tileload/loading/load events, leaving all three counters zero
 * indefinitely. Never fabricate a complete frame based solely on a count
 * from the previous viewport. Verify the *current* tileZoom, current tiles,
 * their loaded timestamps, and prior actual tileload certification.
 */
export type CachedRasterLayer = {
  isLoading?: () => boolean;
  _tileZoom?: number;
  _tiles?: Record<string, {
    current?: boolean;
    loaded?: number;
    coords?: { z?: number };
    el?: object;
  }>;
};

export function certifiedCurrentLeafletTiles(
  layer: CachedRasterLayer,
  mapZoom: number,
  delivered: WeakSet<object>,
): number {
  if (!Number.isFinite(mapZoom) || layer.isLoading?.() !== false ||
      layer._tileZoom === undefined || Math.abs(layer._tileZoom - mapZoom) > 0.01 ||
      !layer._tiles) return 0;
  const tiles = Object.values(layer._tiles).filter((tile) => tile.current === true);
  if (tiles.length === 0) return 0;
  for (const tile of tiles) {
    // A pending/aborted canvas or a tile from the previous map zoom is
    // NOT current source-backed imagery, even if its DOM node still exists.
    if (!tile.el || !tile.loaded || tile.coords?.z !== layer._tileZoom ||
        !delivered.has(tile.el)) return 0;
  }
  return tiles.length;
}

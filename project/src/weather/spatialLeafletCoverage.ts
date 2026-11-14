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
    el?: object & {style?: {visibility?: string; opacity?: string}};
  }>;
};

export function certifiedCurrentLeafletTiles(
  layer: CachedRasterLayer,
  mapZoom: number,
  delivered: WeakSet<object>,
): number {
  // One canonical definition of current viewport coverage for both
  // readiness and QA. Divergent checks would allow "ready" while the
  // diagnostics correctly report a hidden or pending canvas.
  const coverage = currentLeafletCoverage(layer, mapZoom, delivered);
  return coverage.complete ? coverage.delivered : 0;
}

/** Safe diagnostic breakdown of the actual Leaflet viewport, not the
 * cumulative tileload counters. Zero-current means no visible raster grid,
 * not necessarily a failed ECMWF provider; translucent dry tiles are valid. */
export type CurrentTileCoverage = Readonly<{
  required: number; delivered: number; pending: number; hidden: number; complete: boolean;
}>;
export function currentLeafletCoverage(
  layer: CachedRasterLayer, zoom: number, delivered: WeakSet<object>,
): CurrentTileCoverage {
  const requiredTiles = Object.values(layer._tiles ?? {}).filter(t => t.current === true);
  const compatible = Number.isFinite(zoom) && layer._tileZoom !== undefined &&
    Math.abs(layer._tileZoom - zoom) <= 0.01;
  let done = 0, hidden = 0;
  for (const tile of requiredTiles) {
    if (tile.el?.style?.visibility === "hidden" || tile.el?.style?.opacity === "0") hidden++;
    if (compatible && tile.loaded && tile.coords?.z === layer._tileZoom && tile.el &&
        delivered.has(tile.el) && tile.el.style?.visibility !== "hidden" &&
        tile.el.style?.opacity !== "0") done++;
  }
  const required = requiredTiles.length;
  const pending = required - done;
  return {required, delivered: done, pending, hidden,
    complete: compatible && layer.isLoading?.() === false && required > 0 && pending === 0};
}

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
    coords?: { x?: number; y?: number; z?: number };
    el?: object & {style?: {visibility?: string; opacity?: string}};
  }>;
};

export function certifiedCurrentLeafletTiles(
  layer: CachedRasterLayer,
  mapZoom: number,
  delivered: WeakSet<object>,
  viewport?: SpatialRasterViewport,
): number {
  // One canonical definition of current viewport coverage for both
  // readiness and QA. Divergent checks would allow "ready" while the
  // diagnostics correctly report a hidden or pending canvas.
  const coverage = currentLeafletCoverage(layer, mapZoom, delivered, viewport);
  return coverage.complete ? coverage.delivered : 0;
}

/** Safe diagnostic breakdown of the actual Leaflet viewport, not the
 * cumulative tileload counters. Zero-current means no visible raster grid,
 * not necessarily a failed ECMWF provider; translucent dry tiles are valid. */
export type SpatialRasterViewport = Readonly<{
  minX: number; minY: number; maxX: number; maxY: number;
  tileWidth: number; tileHeight: number;
}>;
export type CurrentTileCoverage = Readonly<{
  required: number; delivered: number; pending: number; hidden: number; complete: boolean;
}>;
export function currentLeafletCoverage(
  layer: CachedRasterLayer, zoom: number, delivered: WeakSet<object>,
  viewport?: SpatialRasterViewport,
): CurrentTileCoverage {
  // Leaflet's "current" set is only the grid it HAS constructed. After a
  // continental fling the missing half-screen may not yet have any tile
  // entry: all cached "current" tiles can be loaded and still leave a giant
  // transparent rectangular gap. Never authorize source=spatial on that.
  if (viewport) {
    const fail = (): CurrentTileCoverage => ({
      required: 0, delivered: 0, pending: 0, hidden: 0, complete: false,
    });
    if (!Number.isInteger(zoom) || layer._tileZoom !== zoom ||
        !Object.values(viewport).every(Number.isFinite) ||
        viewport.tileWidth <= 0 || viewport.tileHeight <= 0 ||
        viewport.maxX <= viewport.minX || viewport.maxY <= viewport.minY) return fail();
    const xMin = Math.floor(viewport.minX / viewport.tileWidth);
    const xMax = Math.ceil(viewport.maxX / viewport.tileWidth) - 1;
    const yMin = Math.max(0, Math.floor(viewport.minY / viewport.tileHeight));
    const yMax = Math.min(2 ** zoom - 1, Math.ceil(viewport.maxY / viewport.tileHeight) - 1);
    const required = (xMax - xMin + 1) * (yMax - yMin + 1);
    if (!Number.isSafeInteger(required) || required <= 0 || required > 4096) return fail();
    const present = new Map<string, NonNullable<CachedRasterLayer["_tiles"]>[string]>();
    for (const t of Object.values(layer._tiles ?? {})) {
      if (!t.current || t.coords?.z !== zoom ||
          !Number.isInteger(t.coords?.x ?? NaN) || !Number.isInteger(t.coords?.y ?? NaN)) continue;
      present.set(`${t.coords!.x},${t.coords!.y}`, t);
    }
    let done = 0, hidden = 0;
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const t = present.get(`${x},${y}`);
        if (!t) continue;
        if (t.el?.style?.visibility === "hidden" || t.el?.style?.opacity === "0") hidden++;
        if (t.loaded && t.el && delivered.has(t.el) &&
            t.el.style?.visibility !== "hidden" && t.el.style?.opacity !== "0") done++;
      }
    }
    return { required, delivered: done, pending: required - done, hidden,
      complete: done === required && hidden === 0 && layer.isLoading?.() === false };
  }
  // Legacy no-viewport form exists for offline source tests. Production
  // callers must provide pixel bounds so missing uncreated tiles count.
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

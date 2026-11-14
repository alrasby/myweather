/** A second satellite raster grid is redundant at zooms where both Esri
 * layers resolve to identical {z,x,y} images. Enable the low-resolution
 * underlay only when the main imagery requests genuinely finer detail.
 * This reduces duplicate GPU compositing on Chrome/Android, where tile seams
 * may appear at the boundaries between separately transformed images.
 */
export const SATELLITE_UNDERLAY_NATIVE_ZOOM = 4;
/** Broad world pans must not display the dark map host while all detailed
 * Esri tile requests are still pending. A z2 parent is a REAL satellite tile,
 * not a fake background; it is kept only while low-zoom detail is incomplete.
 * Importantly, do not request a third satellite grid at close zoom levels. */
export const SATELLITE_WORLD_PARENT_NATIVE_ZOOM = 2;
export function shouldKeepWorldSatelliteParent(zoom: number, detailedReady: boolean): boolean {
  // At z3–z4 the native z4 parent requests the very SAME Esri image as
  // the detailed layer. A z2 parent must remain mounted and warm even after
  // detail initially becomes ready: a global fling can otherwise expose
  // the black map host before Leaflet emits the next 'loading' event.
  // Zoom5 already has a distinct, permanent native-z4 parent.
  return Number.isFinite(zoom) && zoom >= 0 &&
    (zoom <= 4 || (zoom === 5 && !detailedReady));
}

/** At z3/z4 a maxNativeZoom=4 parent requests exactly the same Esri URLs
 * as the detail layer, even if its opacity is zero. Unmount that duplicate;
 * the independent z2 parent protects broad world pans. Retain the genuinely
 * coarser z4 imagery at every closer zoom, regardless of detail readiness. */
export function shouldKeepSatelliteParent(zoom: number, _detailReady: boolean): boolean {
  return needsSatelliteUnderlay(zoom);
}
export function needsSatelliteUnderlay(
  zoom: number,
  nativeZoom = SATELLITE_UNDERLAY_NATIVE_ZOOM,
): boolean {
  return Number.isFinite(zoom) && zoom > nativeZoom;
}

/** Chromium on high-density Android devices can expose a 1 CSS-pixel
 * raster tile seam between individually GPU-composited Esri tile images.
 * Apply a small raster-only edge bleed; never stretch OM weather-model data.
 */
export function needsRasterSeamGuard(agent: string, dpr: number): boolean {
  return /Android/i.test(agent) && Number.isFinite(dpr) && dpr >= 1.5;
}

/** Read-only Esri image coverage, separate from ECMWF. No tile URLs, geographic
 * coordinates, or precise device location are ever included in the report.
 *
 * Leaflet's tile.current set includes buffered offscreen images and can omit
 * tiles that have not even been created for the latest screen. Therefore an
 * apparent 6/6 loaded 'current' set does NOT prove the visible screen is covered.
 * Count every expected grid position from the actual map pixel bounds, then
 * demand a real, successfully decoded image at the matching tile coordinate.
 */
export type SatelliteRasterLayerLike = {
  _tileZoom?: number;
  _tiles?: Record<string, {
    current?: boolean; loaded?: number;
    coords?: { x?: number; y?: number; z?: number };
    el?: object & { complete?: boolean; naturalWidth?: number };
  }>;
  isLoading?: () => boolean;
};
export type SatelliteRasterViewport = Readonly<{
  minX: number; maxX: number; minY: number; maxY: number;
  tileWidth: number; tileHeight: number;
}>;
export type SatelliteRasterCoverage = Readonly<{
  active: boolean; required: number; delivered: number; pending: number;
  missing: number; failed: number; loading: boolean; complete: boolean;
}>;
export function snapshotSatelliteRasterCoverage(
  layer: SatelliteRasterLayerLike | null,
  zoom: number,
  failedTiles: WeakSet<object> | undefined,
  viewport: SatelliteRasterViewport,
): SatelliteRasterCoverage {
  const loading = layer?.isLoading?.() === true;
  const empty = (active: boolean): SatelliteRasterCoverage => ({
    active, required: 0, delivered: 0, pending: 0,
    missing: 0, failed: 0, loading, complete: false,
  });
  if (!layer) return empty(false);
  const tileZoom = layer._tileZoom;
  if (!Number.isInteger(zoom) || !Number.isInteger(tileZoom) ||
      tileZoom !== zoom ||
      !Object.values(viewport).every(Number.isFinite) ||
      viewport.tileWidth <= 0 || viewport.tileHeight <= 0 ||
      viewport.maxX <= viewport.minX || viewport.maxY <= viewport.minY) {
    return empty(true);
  }
  const minX = Math.floor(viewport.minX / viewport.tileWidth);
  const maxX = Math.ceil(viewport.maxX / viewport.tileWidth) - 1;
  // EPSG:3857 is periodic in x, but it has no valid polar tiles beyond the
  // native mercator world. Preserve negative and >world x across long pans.
  const nativeMaxY = 2 ** tileZoom! - 1;
  const minY = Math.max(0, Math.floor(viewport.minY / viewport.tileHeight));
  const maxY = Math.min(nativeMaxY, Math.ceil(viewport.maxY / viewport.tileHeight) - 1);
  const required = (maxX - minX + 1) * (maxY - minY + 1);
  // This is an opt-in diagnostic, not a rendering operation. Fail closed on
  // invalid or unexpectedly massive screen geometry rather than iterating.
  if (!Number.isSafeInteger(required) || required <= 0 || required > 4096) return empty(true);

  const tiles = new Map<string, NonNullable<SatelliteRasterLayerLike["_tiles"]>[string]>();
  for (const tile of Object.values(layer._tiles ?? {})) {
    if (tile.current !== true || tile.coords?.z !== tileZoom ||
        !Number.isInteger(tile.coords?.x) || !Number.isInteger(tile.coords?.y)) continue;
    tiles.set(`${tile.coords!.x},${tile.coords!.y}`, tile);
  }
  let delivered = 0, failed = 0, missing = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = tiles.get(`${x},${y}`);
      if (!tile) { missing++; continue; }
      const image = tile.el;
      if (!image) continue;
      if (failedTiles?.has(image) === true ||
          (image.complete === true && image.naturalWidth === 0)) {
        failed++;
        continue;
      }
      if (tile.loaded && image.complete === true &&
          typeof image.naturalWidth === "number" && image.naturalWidth > 0) delivered++;
    }
  }
  const pending = required - delivered - failed;
  return {
    active: true, required, delivered, pending, missing, failed, loading,
    complete: delivered === required && missing === 0 && failed === 0 && !loading,
  };
}

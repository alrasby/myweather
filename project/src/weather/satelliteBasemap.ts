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

/** Read-only, opt-in coverage for Esri IMG tiles, independent of ECMWF.
 * Never log imagery tile URLs, tile coordinates or precise device location. */
export type SatelliteRasterLayerLike = {
  _tileZoom?: number;
  _tiles?: Record<string, {
    current?: boolean; loaded?: number; coords?: { z?: number };
    el?: object & { complete?: boolean; naturalWidth?: number };
  }>;
  isLoading?: () => boolean;
};
export type SatelliteRasterCoverage = Readonly<{
  active: boolean; required: number; delivered: number; pending: number;
  failed: number; loading: boolean; complete: boolean;
}>;
export function snapshotSatelliteRasterCoverage(
  layer: SatelliteRasterLayerLike | null, zoom: number, failedTiles?: WeakSet<object>,
): SatelliteRasterCoverage {
  if (!layer) return {
    active: false, required: 0, delivered: 0, pending: 0,
    failed: 0, loading: false, complete: false,
  };
  const tiles = Object.values(layer._tiles ?? {}).filter((tile) => tile.current === true);
  const compatible = Number.isFinite(zoom) && Number.isFinite(layer._tileZoom) &&
    Math.abs(layer._tileZoom! - zoom) <= 0.01;
  let delivered = 0, failed = 0;
  for (const tile of tiles) {
    const img = tile.el;
    if (!img) continue;
    const broken = failedTiles?.has(img) === true ||
      (img.complete === true && img.naturalWidth === 0);
    if (broken) { failed++; continue; }
    if (compatible && tile.coords?.z === layer._tileZoom && tile.loaded &&
      img.complete === true && typeof img.naturalWidth === "number" &&
      img.naturalWidth > 0) delivered++;
  }
  const required = tiles.length;
  const pending = Math.max(0, required - delivered - failed);
  const loading = layer.isLoading?.() === true;
  return {
    active: true, required, delivered, pending, failed, loading,
    complete: compatible && required > 0 && pending === 0 && failed === 0 && !loading,
  };
}

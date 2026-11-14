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
  return Number.isFinite(zoom) && zoom >= 0 && zoom <= 5 && !detailedReady;
}

/** Retain the parent imagery while the detailed base layer is loading,
 * including when zooming OUT to z4. Removing it on zoomend exposed vertical
 * dark gaps before Esri's detail tiles had arrived. */
export function shouldKeepSatelliteParent(zoom: number, detailReady: boolean): boolean {
  return !detailReady || needsSatelliteUnderlay(zoom);
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

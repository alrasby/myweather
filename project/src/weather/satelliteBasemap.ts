/** A second satellite raster grid is redundant at zooms where both Esri
 * layers resolve to identical {z,x,y} images. Enable the low-resolution
 * underlay only when the main imagery requests genuinely finer detail.
 * This reduces duplicate GPU compositing on Chrome/Android, where tile seams
 * may appear at the boundaries between separately transformed images.
 */
export function needsSatelliteUnderlay(zoom: number, nativeZoom = 5): boolean {
  return Number.isFinite(zoom) && zoom > nativeZoom;
}

/** Chromium on high-density Android devices can expose a 1 CSS-pixel
 * raster tile seam between individually GPU-composited Esri tile images.
 * Apply a small raster-only edge bleed; never stretch OM weather-model data.
 */
export function needsRasterSeamGuard(agent: string, dpr: number): boolean {
  return /Android/i.test(agent) && Number.isFinite(dpr) && dpr >= 1.5;
}

/** The native Android WebView has a single compositor for the Leaflet base
 * tiles, labels and the weather canvas. Streaming base tiles while a fling or
 * pinch is still changing transforms caused vacant raster rectangles.
 * Defer only BASE imagery updates on Android until the map settles; ECMWF
 * tile policy and forecast fidelity remain untouched. */
export function idleBaseTilesOnAndroid(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

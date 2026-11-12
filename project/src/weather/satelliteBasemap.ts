/** A second satellite raster grid is redundant at zooms where both Esri
 * layers resolve to identical {z,x,y} images. Enable the low-resolution
 * underlay only when the main imagery requests genuinely finer detail.
 * This reduces duplicate GPU compositing on Chrome/Android, where tile seams
 * may appear at the boundaries between separately transformed images.
 */
export function needsSatelliteUnderlay(zoom: number, nativeZoom = 5): boolean {
  return Number.isFinite(zoom) && zoom > nativeZoom;
}

/** Use one cheaper, coarser satellite layer only where detailed imagery can
 * expose empty cells on a fast fling. At z=5 use native z=4, not duplicate
 * z=5 tiles; for z>=6 keep the existing z=5 backup. The layer beneath is
 * the SAME real Esri satellite imagery, never synthetic weather coverage. */
export function satelliteUnderlayZoom(zoom: number): 4 | 5 | null {
  if (!Number.isFinite(zoom) || zoom < 5) return null;
  return zoom < 6 ? 4 : 5;
}

/** Chromium on high-density Android devices can expose a 1 CSS-pixel
 * raster tile seam between individually GPU-composited Esri tile images.
 * Apply a small raster-only edge bleed; never stretch OM weather-model data.
 */
export function needsRasterSeamGuard(agent: string, dpr: number): boolean {
  return /Android/i.test(agent) && Number.isFinite(dpr) && dpr >= 1.5;
}

/** A second satellite raster grid is redundant at zooms where both Esri
 * layers resolve to identical {z,x,y} images. Enable the low-resolution
 * underlay only when the main imagery requests genuinely finer detail.
 * This reduces duplicate GPU compositing on Chrome/Android, where tile seams
 * may appear at the boundaries between separately transformed images.
 */
export function needsSatelliteUnderlay(zoom: number, nativeZoom = 5): boolean {
  return Number.isFinite(zoom) && zoom > nativeZoom;
}

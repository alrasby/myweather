/** A completed ECMWF tile set is valid only for its actual Leaflet zoom.
 * After pinch/zoom the old tiles are rendered at a different grid zoom and
 * can no longer authorize a "complete source" or be blended with the new
 * requested hour. Keep it until the gesture settles, then invalidate once.
 */
export function spatialZoomNeedsNewCoverage(
  completedZoom: number | null, currentZoom: number,
): boolean {
  return completedZoom !== null && Number.isFinite(completedZoom) &&
    Number.isFinite(currentZoom) && Math.abs(completedZoom - currentZoom) > 0.01;
}

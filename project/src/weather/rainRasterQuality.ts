/** Reject pixelated global point grids when their longitudinal cell would
 * cover a huge block of the screen. This affects only the COARSE real-data
 * precipitation fallback; official ECMWF .om imagery is never limited here.
 * There is no interpolation or synthetic replacement for missing weather. */
export function usablePrecipitationGrid(
  longitudeSpan: number, columns: number, zoom: number,
  maxCellPixels = 72,
  latitudeCellSpan = 0,
  centerLatitude = 0,
): boolean {
  if (![longitudeSpan, columns, zoom, maxCellPixels, latitudeCellSpan, centerLatitude].every(Number.isFinite) ||
      longitudeSpan <= 0 || columns <= 0 || zoom < 0 || maxCellPixels <= 0 ||
      latitudeCellSpan < 0) return false;
  const pixelsPerDegree = (256 * 2 ** zoom) / 360;
  const horizontalPixels = pixelsPerDegree * (longitudeSpan / columns);
  // Web Mercator enlarges N/S spans near the poles. A 9-degree grid
  // latitude cell that is tolerable in Oman can be a giant slab at 60N.
  const mercatorScale = 1 / Math.max(0.22, Math.cos(centerLatitude * Math.PI / 180));
  const verticalPixels = pixelsPerDegree * latitudeCellSpan * mercatorScale;
  return Math.max(horizontalPixels, verticalPixels) <= maxCellPixels;
}

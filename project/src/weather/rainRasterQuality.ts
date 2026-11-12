/** Reject pixelated global point grids when their longitudinal cell would
 * cover a huge block of the screen. This affects only the COARSE real-data
 * precipitation fallback; official ECMWF .om imagery is never limited here.
 * There is no interpolation or synthetic replacement for missing weather. */
export function usablePrecipitationGrid(
  longitudeSpan: number, columns: number, zoom: number,
  maxCellPixels = 72,
): boolean {
  if (![longitudeSpan, columns, zoom, maxCellPixels].every(Number.isFinite) ||
      longitudeSpan <= 0 || columns <= 0 || zoom < 0 || maxCellPixels <= 0) return false;
  const pixelsPerCell = (256 * 2 ** zoom) * (longitudeSpan / columns) / 360;
  return pixelsPerCell <= maxCellPixels;
}

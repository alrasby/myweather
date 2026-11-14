/** Per-pixel colour interpolation matching Open-Meteo's breakpoint
 * makeColorSampler(colorBlend=true), extracted for deterministic parity tests.
 * The caller reuses the same four-element output buffer for every pixel. */
export type SpatialRasterPalette = { breakpoints: number[]; colors: number[][] };
export function spatialRasterColor(
  palette: SpatialRasterPalette,
  value: number,
  out: number[],
): number[] {
  const { breakpoints, colors } = palette;
  let low = 0, high = breakpoints.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (value >= breakpoints[mid]!) { found = mid; low = mid + 1; }
    else high = mid - 1;
  }
  const index = Math.max(0, found);
  const next = Math.min(colors.length - 1, index + 1);
  const a = colors[index]!, b = colors[next]!;
  const denominator = breakpoints[next]! - breakpoints[index]!;
  const t = denominator > 0
    ? Math.max(0, Math.min(1, (value - breakpoints[index]!) / denominator)) : 0;
  for (let channel = 0; channel < 4; channel++) {
    out[channel] = a[channel]! + (b[channel]! - a[channel]!) * t;
  }
  return out;
}
export function spatialTileLongitude(x: number, zoom: number): number {
  // Mathematical modulo across *any* number of westward world copies.
  // JS % keeps negative remainders: the old upstream formula can return
  // <-180 for x < -2^zoom, making previously valid copied-world cloud tiles
  // sample off-grid and paint blank rectangles during long global pans.
  const raw = (x / 2 ** zoom) * 360;
  return ((raw % 360 + 540) % 360) - 180;
}
export function spatialTileLatitude(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return Math.atan(Math.sinh(n)) * (180 / Math.PI);
}

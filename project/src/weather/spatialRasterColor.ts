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
  // Same coordinate convention as upstream tile2lon, including ±180 wraps.
  return (((x / 2 ** zoom) * 360 + 360) % 360) - 180;
}
export function spatialTileLatitude(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return Math.atan(Math.sinh(n)) * (180 / Math.PI);
}

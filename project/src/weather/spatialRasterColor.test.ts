import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialRasterColor, spatialTileLatitude, spatialTileLongitude } from "./spatialRasterColor.ts";

// Independent reference from upstream weather-map-layer's getColor
// breakpoint + colorBlend=true. Exercise exact thresholds, transparent alpha,
// and adjacent tile coordinates to prevent custom/legacy seams.
function referenceColor(breakpoints: number[], colors: number[][], value: number) {
  let idx = 0;
  for (let i = 0; i < breakpoints.length; i++) {
    if (breakpoints[i]! <= value) idx = i; else break;
  }
  const next = Math.min(idx + 1, colors.length - 1);
  const t = breakpoints[next]! > breakpoints[idx]!
    ? Math.min(1, Math.max(0, (value - breakpoints[idx]!) /
        (breakpoints[next]! - breakpoints[idx]!))) : 0;
  return colors[idx]!.map((v, i) => v + (colors[next]![i]! - v) * t);
}
test("custom ECMWF raster RGBA agrees with upstream breakpoint interpolation", () => {
  const scales = [
    { breakpoints: [55, 70, 82, 90, 96, 100],
      colors: [[255,255,255,0],[255,255,255,0],[249,252,255,.11],
        [248,251,255,.31],[244,249,255,.54],[244,249,255,.68]] },
    { breakpoints: [.12,.4,.9,1.8,3.5,7,12,20],
      colors: [[176,214,248,0],[72,158,236,.65],[22,104,214,.83],
        [14,158,86,.88],[190,206,22,.91],[255,176,0,.94],
        [224,58,26,.96],[132,34,176,.97]] },
    { breakpoints: [.08,.25,.7,1.6],
      colors: [[213,229,249,0],[154,204,251,.74],
        [226,243,255,.90],[249,253,255,.95]] },
  ];
  for (const palette of scales) {
    for (const value of [-1, 0, ...palette.breakpoints,
      ...palette.breakpoints.slice(1).map((x,i) => (x + palette.breakpoints[i]!) / 2), 400]) {
      const expected = referenceColor(palette.breakpoints, palette.colors, value);
      const actual = spatialRasterColor(palette, value, [0,0,0,0]);
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(actual[i]! - expected[i]!) < 1e-10,
          `value=${value} channel=${i} observed=${actual[i]}`);
      }
    }
  }
});
test("pixel-center projection matches the official worker near dateline and poles", () => {
  for (const zoom of [0, 1, 5, 9, 13]) {
    for (const x of [-2, 0, 0.125, 2**zoom-.25, 2**zoom+0.25]) {
      const expected = (((x / Math.pow(2, zoom)) * 360 + 360) % 360) - 180;
      assert.ok(Math.abs(spatialTileLongitude(x,zoom) - expected) < 1e-10);
    }
    for (const y of [0.01, .25, 2**zoom/2, 2**zoom-.25]) {
      const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
      const expected = Math.atan(.5 * (Math.exp(n) - Math.exp(-n))) * 180 / Math.PI;
      assert.ok(Math.abs(spatialTileLatitude(y, zoom) - expected) < 1e-10);
    }
  }
});

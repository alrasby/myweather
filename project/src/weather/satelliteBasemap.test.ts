import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay, needsRasterSeamGuard, idleBaseTilesOnAndroid } from "./satelliteBasemap.ts";

test("the world map never renders duplicate Esri raster grids", () => {
  for (const zoom of [3, 4, 5]) assert.equal(needsSatelliteUnderlay(zoom), false);
});
test("the low-resolution safety underlay remains at closer zoom levels", () => {
  for (const zoom of [6, 7, 12, 16]) assert.equal(needsSatelliteUnderlay(zoom), true);
  assert.equal(needsSatelliteUnderlay(Number.NaN), false);
});

test("Android raster seam mitigation excludes other browsers and low density screens", () => {
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 3), true);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 1), false);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 3), false);
});

test("Android satellite tiles wait for settled camera; desktop retains streaming", () => {
  assert.equal(idleBaseTilesOnAndroid("Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36"), true);
  assert.equal(idleBaseTilesOnAndroid("Mozilla/5.0 (Windows NT 10.0; Win64)"), false);
  assert.equal(idleBaseTilesOnAndroid("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), false);
});

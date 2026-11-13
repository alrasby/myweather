import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay, needsRasterSeamGuard, shouldKeepSatelliteParent, SATELLITE_UNDERLAY_NATIVE_ZOOM } from "./satelliteBasemap.ts";

test("the world map never renders duplicate Esri raster grids", () => {
  for (const zoom of [3, 4]) assert.equal(needsSatelliteUnderlay(zoom), false);
  assert.equal(SATELLITE_UNDERLAY_NATIVE_ZOOM, 4);
});
test("the low-resolution safety underlay remains at closer zoom levels", () => {
  for (const zoom of [5, 6, 7, 12, 16]) assert.equal(needsSatelliteUnderlay(zoom), true);
  assert.equal(needsSatelliteUnderlay(Number.NaN), false);
});

test("Android raster seam mitigation excludes other browsers and low density screens", () => {
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 3), true);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 1), false);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 3), false);
});
test("satellite parent remains until detailed imagery finishes after zooming out", () => {
  assert.equal(shouldKeepSatelliteParent(5, true), true);
  assert.equal(shouldKeepSatelliteParent(4, false), true);
  assert.equal(shouldKeepSatelliteParent(4, true), false);
  assert.equal(shouldKeepSatelliteParent(3, false), true);
  assert.equal(shouldKeepSatelliteParent(3, true), false);
});

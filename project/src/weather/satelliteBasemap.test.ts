import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay, satelliteUnderlayZoom, needsRasterSeamGuard } from "./satelliteBasemap.ts";

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

test("zoom-5 fling retains a real coarser satellite background without doubling detailed tiles", () => {
  assert.equal(satelliteUnderlayZoom(3), null);
  assert.equal(satelliteUnderlayZoom(4), null);
  assert.equal(satelliteUnderlayZoom(5), 4);
  assert.equal(satelliteUnderlayZoom(5.5), 4);
  assert.equal(satelliteUnderlayZoom(6), 5);
  assert.equal(satelliteUnderlayZoom(13), 5);
  assert.equal(satelliteUnderlayZoom(NaN), null);
});

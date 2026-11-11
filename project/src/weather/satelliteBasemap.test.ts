import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay } from "./satelliteBasemap.ts";

test("the world map never renders duplicate Esri raster grids", () => {
  for (const zoom of [3, 4, 5]) assert.equal(needsSatelliteUnderlay(zoom), false);
});
test("the low-resolution safety underlay remains at closer zoom levels", () => {
  for (const zoom of [6, 7, 12, 16]) assert.equal(needsSatelliteUnderlay(zoom), true);
  assert.equal(needsSatelliteUnderlay(Number.NaN), false);
});

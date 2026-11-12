import assert from "node:assert/strict";
import { test } from "node:test";
import { usablePrecipitationGrid } from "./rainRasterQuality.ts";

test("coarse global rain stays hidden when a cell expands to a huge rectangle", () => {
  assert.equal(usablePrecipitationGrid(360, 36, 4), false); // ~114px per cell
  assert.equal(usablePrecipitationGrid(360, 36, 3), true);  // ~57px per cell
  assert.equal(usablePrecipitationGrid(360, 72, 4), true);  // ~57px per cell
  assert.equal(usablePrecipitationGrid(360, 72, 5), false); // ~114px per cell
});
test("regional source-backed rain is still usable at practical zoom", () => {
  assert.equal(usablePrecipitationGrid(20, 70, 6), true);
  assert.equal(usablePrecipitationGrid(20, 70, 8), false);
});
test("unavailable or malformed grids never turn into fake weather", () => {
  assert.equal(usablePrecipitationGrid(360, 0, 4), false);
  assert.equal(usablePrecipitationGrid(NaN, 36, 4), false);
  assert.equal(usablePrecipitationGrid(360, 36, -1), false);
});

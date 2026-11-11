import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldReplanSpatialFrame, spatialCoverageChanged } from "./modelRenderPolicy.ts";

test("ECMWF time blending does not replan the same tiles 20 times a second", () => {
  assert.equal(shouldReplanSpatialFrame(false, 149, 100), false);
  assert.equal(shouldReplanSpatialFrame(false, 599, 100), false);
  assert.equal(shouldReplanSpatialFrame(false, 600, 100), true);
  assert.equal(shouldReplanSpatialFrame(true, 130, 100), true);
});
test("ECMWF coverage callbacks only run when switching to or from fallback", () => {
  assert.equal(spatialCoverageChanged(false, false), false);
  assert.equal(spatialCoverageChanged(true, true), false);
  assert.equal(spatialCoverageChanged(true, false), true);
  assert.equal(spatialCoverageChanged(false, true), true);
});

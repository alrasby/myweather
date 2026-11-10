import assert from "node:assert/strict";
import { test } from "node:test";
import { modelTileFrameReady, SPATIAL_LAYER_COUNT } from "./modelTileReadiness.ts";

test("cloud, rain and snowfall must all load successfully", () => {
  assert.equal(SPATIAL_LAYER_COUNT, 3);
  assert.equal(modelTileFrameReady([true, true, true], new Set()), true);
  assert.equal(modelTileFrameReady([true, false, true], new Set()), false);
  assert.equal(modelTileFrameReady([true, true], new Set()), false);
  assert.equal(modelTileFrameReady([true, true, true, true], new Set()), false);
  assert.equal(modelTileFrameReady([true, true, true], new Set([2])), false);
});

test("fully loaded but transparent rain and snow are valid dry conditions", () => {
  // Readiness depends on complete data delivery, not whether a tile happens
  // to contain precipitation pixels; dry weather must not force coarse fallback.
  assert.equal(modelTileFrameReady([true, true, true], new Set()), true);
});

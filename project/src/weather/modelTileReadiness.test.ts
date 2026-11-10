import assert from "node:assert/strict";
import { test } from "node:test";
import { modelTileFrameReady, modelVariablesReady, SPATIAL_LAYER_COUNT } from "./modelTileReadiness.ts";

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

test("metadata refuses models missing any essential weather field", () => {
  assert.equal(modelVariablesReady(["cloud_cover", "precipitation", "snowfall_water_equivalent"]), true);
  assert.equal(modelVariablesReady(["cloud_cover", "precipitation"]), false);
  assert.equal(modelVariablesReady(["cloud_cover", "snowfall_water_equivalent"]), false);
  assert.equal(modelVariablesReady(["precipitation", "snowfall_water_equivalent"]), false);
  assert.equal(modelVariablesReady(), true);
});

test("a layer load event with no tile delivery cannot replace the fallback", () => {
  assert.equal(modelTileFrameReady([true, true, true], new Set(), [3, 2, 0]), false);
  assert.equal(modelTileFrameReady([true, true, true], new Set(), [3, 2, 1]), true);
  assert.equal(modelTileFrameReady([true, true, true], new Set(), [3, 2]), false);
  assert.equal(modelTileFrameReady([true, true, true], new Set([1]), [3, 2, 1]), false);
});

test("dry tiles count as delivered even when they have no coloured precipitation pixels", () => {
  assert.equal(modelTileFrameReady([true, true, true], new Set(), [1, 1, 1]), true);
});

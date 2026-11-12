import assert from "node:assert/strict";
import { test } from "node:test";
import { modelTileFrameReady, modelVariablesReady, spatialFrameReadyDuringRefresh, spatialCloudPreviewReady, SPATIAL_LAYER_COUNT } from "./modelTileReadiness.ts";
import { SpatialTileReveal, canStageSpatialRefresh } from "./spatialTileReveal.ts";

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

test("panning retains a previously ready spatial weather frame while new tiles load", () => {
  const counts = [4, 4, 4];
  const noErrors = new Set<number>();
  assert.equal(spatialFrameReadyDuringRefresh(true, [false, true, true], noErrors, counts), true);
  assert.equal(spatialFrameReadyDuringRefresh(true, [false, false, false], noErrors, counts), true);
  assert.equal(spatialFrameReadyDuringRefresh(true, [true, true, true], noErrors, counts), true);
});

test("initial spatial imagery cannot appear before all queues deliver", () => {
  const noErrors = new Set<number>();
  assert.equal(spatialFrameReadyDuringRefresh(false, [false, true, true], noErrors, [0, 4, 4]), false);
  assert.equal(spatialFrameReadyDuringRefresh(false, [true, true, true], noErrors, [0, 4, 4]), false);
  assert.equal(spatialFrameReadyDuringRefresh(false, [true, true, true], noErrors, [4, 4, 4]), true);
});

test("completed errored refresh is rejected and dry tiles remain valid", () => {
  const counts = [4, 4, 4];
  assert.equal(spatialFrameReadyDuringRefresh(true, [true, true, true], new Set([0]), counts), false);
  assert.equal(spatialFrameReadyDuringRefresh(true, [true, true, true], new Set(), counts), true);
});

test("ECMWF cloud preview starts after real cloud tiles arrive even while precipitation and snow are decoding", () => {
  assert.equal(spatialCloudPreviewReady(false, [false, false, false], new Set(), [0, 0, 0]), false);
  assert.equal(spatialCloudPreviewReady(false, [true, false, false], new Set(), [0, 0, 0]), false);
  assert.equal(spatialCloudPreviewReady(false, [true, false, false], new Set(), [3, 0, 0]), true);
  assert.equal(spatialCloudPreviewReady(true, [false, false, false], new Set(), [3, 0, 0]), true);
  assert.equal(spatialCloudPreviewReady(true, [false, false, false], new Set([0]), [3, 0, 0]), false);
  assert.equal(spatialCloudPreviewReady(false, [false, true, true], new Set(), [0, 2, 3]), false);
});

test("viewport tile batch becomes visible atomically, preserving original styles", () => {
  const gate = new SpatialTileReveal();
  const first = { style: { visibility: "" } };
  const second = { style: { visibility: "visible" } };
  gate.hold(first);
  gate.hold(second);
  gate.hold(first);
  assert.equal(gate.pending, 2);
  assert.equal(first.style.visibility, "hidden");
  assert.equal(second.style.visibility, "hidden");
  gate.release();
  assert.equal(first.style.visibility, "");
  assert.equal(second.style.visibility, "visible");
  assert.equal(gate.pending, 0);
  // New viewport starts its own batch; old state must not leak.
  gate.hold(first);
  gate.discard(first);
  assert.equal(first.style.visibility, "");
  assert.equal(gate.pending, 0);
  gate.hold(undefined);
  gate.discard(undefined);
});

test("batch reveal is allowed only when the previous raster still covers the new view", () => {
  const a = { west: 8, east: 38, south: 48, north: 68, zoom: 6 };
  assert.equal(canStageSpatialRefresh(null, a), false);
  assert.equal(canStageSpatialRefresh(a, { ...a, west: 10, east: 40 }), true);
  assert.equal(canStageSpatialRefresh(a, { ...a, west: 18, east: 48 }), false);
  assert.equal(canStageSpatialRefresh(a, { ...a, zoom: 7 }), false);
  assert.equal(canStageSpatialRefresh(a, { ...a, south: 58, north: 78 }), false);
  assert.equal(canStageSpatialRefresh(a, { ...a, west: 368, east: 398 }), true);
  assert.equal(canStageSpatialRefresh(a, { ...a, east: NaN }), false);
});

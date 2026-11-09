import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrecipitationTile, modelTileFrameReady } from "./modelTileReadiness.ts";

test("weather-model frame remains hidden until all tile queues are loaded", () => {
  assert.equal(modelTileFrameReady(false, [true, true, true], new Set()), false);
  assert.equal(modelTileFrameReady(true, [true, false, true], new Set()), false);
  assert.equal(modelTileFrameReady(true, [true, true, true], new Set()), true);
});

test("failed and incomplete weather tiles preserve global rain fallback", () => {
  const errors = new Set([1]);
  assert.equal(modelTileFrameReady(true, [true, true, true], errors), false);
  errors.clear();
  assert.equal(modelTileFrameReady(true, [true, true, true], errors), true);
  assert.equal(modelTileFrameReady(true, [true, true], new Set()), false);
});

test("cloud-only tiles cannot replace the global rain or snow field", () => {
  assert.equal(isPrecipitationTile(0), false);
  assert.equal(isPrecipitationTile(1), true);
  assert.equal(isPrecipitationTile(2), true);
  const cloudInk = true;
  const precipitationInk = false;
  assert.equal(modelTileFrameReady(precipitationInk, [true, true, true], new Set()), false);
  assert.equal(cloudInk && !isPrecipitationTile(0), true);
});

test("snow or rain tiles can activate a completed model frame", () => {
  for (const weatherTileIndex of [1, 2]) {
    assert.equal(isPrecipitationTile(weatherTileIndex), true);
    assert.equal(modelTileFrameReady(true, [true, true, true], new Set()), true);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { modelTileFrameReady } from "./modelTileReadiness.ts";

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

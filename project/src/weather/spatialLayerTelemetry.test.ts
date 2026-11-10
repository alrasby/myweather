import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialLayerTiming } from "./spatialLayerTelemetry.ts";
test("tracks tile time-to-first-byte and elapsed fetch separately for cloud/rain/snow", () => {
  assert.deepEqual(spatialLayerTiming(15000, 1000, 5000, 9000, 0), {
    elapsedMs: 14000, firstTileMs: 4000, idleMs: 6000,
  });
  assert.deepEqual(spatialLayerTiming(16000, 1000, 5000, 9000, 12500), {
    elapsedMs: 11500, firstTileMs: 4000, idleMs: null,
  });
});
test("pending layers without any delivered tiles show elapsed time but not fabricated progress", () => {
  assert.deepEqual(spatialLayerTiming(6000, 1000, 0, 0, 0), {
    elapsedMs: 5000, firstTileMs: null, idleMs: null,
  });
  assert.deepEqual(spatialLayerTiming(6000, 0, 0, 0, 0), {
    elapsedMs: 0, firstTileMs: null, idleMs: null,
  });
});

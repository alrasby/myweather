import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SPATIAL_IDLE_LIMIT_MS, SPATIAL_TOTAL_LIMIT_MS, spatialFrameTimedOut,
} from "./spatialWatchdog.ts";

test("a large frame with recent tile progress is not cancelled at 20s", () => {
  assert.equal(spatialFrameTimedOut(25_000, 0, 24_500), false);
  assert.equal(spatialFrameTimedOut(40_000, 0, 35_000), false);
});

test("a genuinely stalled frame is discarded and may be retried", () => {
  assert.equal(spatialFrameTimedOut(SPATIAL_IDLE_LIMIT_MS, 0, 0), true);
  assert.equal(spatialFrameTimedOut(45_000, 0, 14_999), true);
});

test("a constantly active request still has a finite overall deadline", () => {
  assert.equal(spatialFrameTimedOut(SPATIAL_TOTAL_LIMIT_MS - 1, 0, SPATIAL_TOTAL_LIMIT_MS - 2), false);
  assert.equal(spatialFrameTimedOut(SPATIAL_TOTAL_LIMIT_MS, 0, SPATIAL_TOTAL_LIMIT_MS - 1), true);
});

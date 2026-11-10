import assert from "node:assert/strict";
import { test } from "node:test";
import { planSpatialRequests, canAdvanceSpatialTime } from "./modelFrameQueue.ts";

test("only one current ECMWF frame loads; next is prefetched after it becomes ready", () => {
  assert.deepEqual(planSpatialRequests(6, 30, new Set(), new Set(), new Set()), { cancel: [], start: 6 });
  assert.deepEqual(planSpatialRequests(6, 30, new Set([6]), new Set(), new Set()), { cancel: [], start: 7 });
  assert.deepEqual(planSpatialRequests(6, 30, new Set([6]), new Set([7]), new Set()), { cancel: [], start: null });
});
test("an obsolete in-flight frame is cancelled instead of saturating the decoder", () => {
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set([7]), new Set()), { cancel: [7], start: 18 });
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set([18]), new Set()), { cancel: [], start: null });
});
test("retry cooldown allows the adjacent hour instead of hammering a failed frame", () => {
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set(), new Set([18])), { cancel: [], start: 19 });
  assert.deepEqual(planSpatialRequests(19, 20, new Set([6]), new Set(), new Set()), { cancel: [], start: 19 });
  assert.deepEqual(planSpatialRequests(19, 20, new Set([19]), new Set(), new Set()), { cancel: [], start: null });
});
test("a new requested frame takes priority over obsolete prefetch", () => {
  assert.deepEqual(planSpatialRequests(22, 40, new Set([21]), new Set([23]), new Set()), { cancel: [23], start: 22 });
});
test("playback waits at unready boundaries, but never hangs on a provider error", () => {
  assert.equal(canAdvanceSpatialTime(9, new Set([8]), new Set()), false);
  assert.equal(canAdvanceSpatialTime(9, new Set([9]), new Set()), true);
  assert.equal(canAdvanceSpatialTime(9, new Set([10]), new Set()), true);
  assert.equal(canAdvanceSpatialTime(9, new Set([8]), new Set([9])), true);
  assert.equal(canAdvanceSpatialTime(9, new Set(), new Set()), true);
});

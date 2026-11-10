import assert from "node:assert/strict";
import { test } from "node:test";
import { planSpatialRequests, canAdvanceSpatialTime, SPATIAL_PREFETCH_GRACE_MS } from "./modelFrameQueue.ts";

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
  assert.equal(canAdvanceSpatialTime(9, new Set(), new Set(), new Set([9])), false);
  assert.equal(canAdvanceSpatialTime(9, new Set(), new Set([9]), new Set([9])), true);
});

test("viewport refresh temporarily defers starting new prefetch", () => {
  const ready = new Set([8]);
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), true, 0), { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), true, SPATIAL_PREFETCH_GRACE_MS - 1), { cancel: [], start: null });
  const settled = planSpatialRequests(8, 32, ready, new Set(), new Set(), false);
  assert.deepEqual(settled, { cancel: [], start: 9 });
});

test("continuous panning cannot starve the next forecast after 2.5 seconds", () => {
  const ready = new Set([8]);
  const plan = planSpatialRequests(8, 32, ready, new Set(), new Set(), true, SPATIAL_PREFETCH_GRACE_MS);
  assert.deepEqual(plan, { cancel: [], start: 9 });
});

test("an in-flight next hour is preserved when the map starts refreshing", () => {
  const ready = new Set([8]);
  const plan = planSpatialRequests(8, 32, ready, new Set([9]), new Set(), true, 100);
  assert.deepEqual(plan, { cancel: [], start: null });
});


test("map movement never blocks the requested hour when that hour is missing", () => {
  assert.deepEqual(
    planSpatialRequests(12, 32, new Set([9]), new Set([13]), new Set(), true),
    { cancel: [13], start: 12 },
  );
});

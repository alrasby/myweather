import assert from "node:assert/strict";
import { test } from "node:test";
import { planSpatialRequests, canAdvanceSpatialTime, SPATIAL_PREFETCH_GRACE_MS, SPATIAL_PLAYBACK_VIEWPORT_GRACE_MS, significantSpatialMove } from "./modelFrameQueue.ts";

test("only one current ECMWF frame loads; next is prefetched after it becomes ready", () => {
  assert.deepEqual(planSpatialRequests(6, 30, new Set(), new Set(), new Set()), { cancel: [], start: 6 });
  assert.deepEqual(planSpatialRequests(6, 30, new Set([6]), new Set(), new Set()), { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(6, 30, new Set([6]), new Set(), new Set(), false, 0, true), { cancel: [], start: 7 });
  assert.deepEqual(planSpatialRequests(6, 30, new Set([6]), new Set([7]), new Set(), false, 0, true), { cancel: [], start: null });
});
test("an obsolete in-flight frame is cancelled instead of saturating the decoder", () => {
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set([7]), new Set()), { cancel: [7], start: 18 });
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set([18]), new Set()), { cancel: [], start: null });
});
test("retry cooldown allows the adjacent hour instead of hammering a failed frame", () => {
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set(), new Set([18])), { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(18, 40, new Set([6]), new Set(), new Set([18]), false, 0, true), { cancel: [], start: 19 });
  assert.deepEqual(planSpatialRequests(19, 20, new Set([6]), new Set(), new Set()), { cancel: [], start: 19 });
  assert.deepEqual(planSpatialRequests(19, 20, new Set([19]), new Set(), new Set()), { cancel: [], start: null });
});
test("a new requested frame takes priority over obsolete prefetch", () => {
  assert.deepEqual(planSpatialRequests(22, 40, new Set([21]), new Set([23]), new Set()), { cancel: [23], start: 22 });
});
test("playback waits at unready boundaries, but never hangs on a provider error", () => {
  assert.equal(canAdvanceSpatialTime(9, new Set([8]), new Set()), false);
  assert.equal(canAdvanceSpatialTime(9, new Set([9]), new Set()), true);
  assert.equal(canAdvanceSpatialTime(9, new Set([10]), new Set()), false);
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
  assert.deepEqual(settled, { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), false, 0, true),
    { cancel: [], start: 9 });
});

test("continuous panning cannot starve future model hours after bounded viewport grace", () => {
  const ready = new Set([8]);
  const plan = planSpatialRequests(8, 32, ready, new Set(), new Set(), true, SPATIAL_PREFETCH_GRACE_MS, true);
  assert.deepEqual(plan, { cancel: [], start: 9 });
});

test("small map drags preserve in-flight prefetch but do not launch new work", () => {
  const ready = new Set([8]);
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set([9]), new Set(), true, 100),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set([9]), new Set(), true, 5000, true, true),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), true, 5000, true, true),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), false),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, ready, new Set(), new Set(), false, 0, true),
    { cancel: [], start: 9 });
});


test("map movement never blocks the requested hour when that hour is missing", () => {
  assert.deepEqual(
    planSpatialRequests(12, 32, new Set([9]), new Set([13]), new Set(), true),
    { cancel: [13], start: 12 },
  );
});

test("clouds cannot remain frozen while the time slider skips unready model hours", () => {
  assert.equal(canAdvanceSpatialTime(16, new Set([10]), new Set(), new Set([16])), false);
  assert.equal(canAdvanceSpatialTime(16, new Set([16]), new Set(), new Set()), true);
  // A future forecast alone cannot authorize showing the current time.
  assert.equal(canAdvanceSpatialTime(16, new Set([17]), new Set(), new Set()), false);
});

test("a genuinely failed spatial hour may continue only via explicit fallback", () => {
  assert.equal(canAdvanceSpatialTime(16, new Set([10]), new Set([16]), new Set()), true);
});

test("second-hour lookahead starts only when current and next are complete", () => {
  assert.deepEqual(
    planSpatialRequests(8, 32, new Set([8, 9]), new Set(), new Set(), false, 0, true),
    { cancel: [], start: 10 },
  );
  assert.deepEqual(
    planSpatialRequests(8, 32, new Set([8]), new Set(), new Set(), false, 0, true),
    { cancel: [], start: 9 },
  );
  assert.deepEqual(
    planSpatialRequests(8, 32, new Set([8, 9]), new Set([10]), new Set(), false, 0, true),
    { cancel: [], start: null },
  );
});

test("two-hour prefetch is bounded to existing forecast horizon", () => {
  assert.deepEqual(
    planSpatialRequests(30, 32, new Set([30, 31]), new Set(), new Set(), false, 0, true),
    { cancel: [], start: null },
  );
});

test("continuous viewport refresh preserves existing second-hour work while not starting another", () => {
  assert.deepEqual(
    planSpatialRequests(8, 32, new Set([8, 9]), new Set([10]), new Set(), true, 200, true),
    { cancel: [], start: null },
  );
});

test("active playback favors visible ECMWF decoding for a bounded period", () => {
  const ready = new Set([8]);
  assert.deepEqual(
    planSpatialRequests(8, 32, ready, new Set([9]), new Set(), true, 100, true),
    { cancel: [], start: null },
  );
  assert.deepEqual(
    planSpatialRequests(8, 32, ready, new Set(), new Set(), true, SPATIAL_PLAYBACK_VIEWPORT_GRACE_MS - 1, true),
    { cancel: [], start: null },
  );
  assert.deepEqual(
    planSpatialRequests(8, 32, ready, new Set(), new Set(), true, SPATIAL_PLAYBACK_VIEWPORT_GRACE_MS, true),
    { cancel: [], start: 9 },
  );
});

test("a still map never decodes unused future hours", () => {
  assert.deepEqual(planSpatialRequests(8, 32, new Set([8]), new Set(), new Set()),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, new Set([8, 9]), new Set(), new Set()),
    { cancel: [], start: null });
  assert.deepEqual(planSpatialRequests(8, 32, new Set([8, 9]), new Set(), new Set(), false, 0, true),
    { cancel: [], start: 10 });
});

test("playback never starts more than one unready frame while the next is loading", () => {
  const plan = planSpatialRequests(8, 32, new Set([8]), new Set([9]), new Set(), true, 5000, true);
  assert.deepEqual(plan, { cancel: [], start: null });
});

test("a real precipitation fallback may advance time while ECMWF decodes without mislabeling a held frame", () => {
  assert.equal(canAdvanceSpatialTime(9, new Set([8]), new Set(), new Set([9]), true), true);
  assert.equal(canAdvanceSpatialTime(9, new Set([8]), new Set(), new Set([9]), false), false);
  assert.equal(canAdvanceSpatialTime(9, new Set([9]), new Set(), new Set([10]), false), true);
});

test("spatial move threshold ignores tiny gestures and wraps around the dateline", () => {
  const a = { lat: 40, lng: 179, zoom: 5 };
  assert.equal(significantSpatialMove(a, { lat: 40.1, lng: -179, zoom: 5 }, 20, 30), false);
  assert.equal(significantSpatialMove(a, { lat: 48, lng: 179, zoom: 5 }, 20, 30), true);
  assert.equal(significantSpatialMove(a, { lat: 40, lng: -166, zoom: 5 }, 20, 30), true);
  assert.equal(significantSpatialMove(a, { lat: 40, lng: 179, zoom: 6 }, 20, 30), true);
  assert.equal(significantSpatialMove(a, { lat: 40, lng: 179, zoom: 5 }, 20, 30), false);
  assert.equal(significantSpatialMove(a, { lat: 40, lng: 179, zoom: 5 }, 0, 30), true);
});
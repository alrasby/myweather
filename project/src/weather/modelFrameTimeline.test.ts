import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSpatialFramePlan, spatialStackKey } from "./modelFrameTimeline.ts";

test("holds the last valid spatial frame during an unloaded time seek", () => {
  const plan = selectSpatialFramePlan(12, 0.4, new Set([6]), 6);
  assert.equal(plan.anchor, 6);
  assert.equal(plan.holding, true);
  assert.equal(plan.goals.get(6), 1);
});
test("does not show an unloaded next frame before it is ready", () => {
  const plan = selectSpatialFramePlan(6, 0.8, new Set([6]), 6);
  assert.equal(plan.anchor, 6);
  assert.deepEqual([...plan.goals], [[6, 1]]);
});
test("crossfades only after adjacent frames are both ready", () => {
  const plan = selectSpatialFramePlan(6, 0.4, new Set([6, 7]), 6);
  assert.equal(plan.holding, false);
  assert.equal(plan.anchor, 6);
  assert.equal(plan.goals.get(6), 0.6);
  assert.equal(plan.goals.get(7), 0.4);
});
test("loads the next complete spatial frame without exposing fallback", () => {
  const plan = selectSpatialFramePlan(7, 0.2, new Set([6, 7]), 6);
  assert.equal(plan.anchor, 7);
  assert.deepEqual([...plan.goals], [[7, 1]]);
});
test("retains the prior frame when the requested frame times out", () => {
  const plan = selectSpatialFramePlan(14, 0, new Set([7]), 7);
  assert.deepEqual([...plan.goals], [[7, 1]]);
});
test("falls back only if no valid spatial frame exists", () => {
  const plan = selectSpatialFramePlan(14, 0, new Set(), 7);
  assert.equal(plan.anchor, null);
  assert.equal(plan.goals.size, 0);
});
test("clamps interpolation to valid weights", () => {
  assert.deepEqual([...selectSpatialFramePlan(1, -3, new Set([1,2]), 1).goals.values()], [1,0]);
  assert.deepEqual([...selectSpatialFramePlan(1, 3, new Set([1,2]), 1).goals.values()], [0,1]);
});

test("provider retry cooldown prevents old or future spatial clouds being shown for a different hour", () => {
  const oldReady = selectSpatialFramePlan(18, 0.3, new Set([10]), 10, true);
  assert.equal(oldReady.anchor, null);
  assert.equal(oldReady.goals.size, 0);
  const futureOnly = selectSpatialFramePlan(18, 0.3, new Set([19]), 19, true);
  assert.equal(futureOnly.anchor, null);
  assert.equal(futureOnly.goals.size, 0);
});

test("pending hour temporarily holds old imagery ONLY while playback remains gated", () => {
  const pending = selectSpatialFramePlan(18, 0.3, new Set([10]), 10, false);
  assert.equal(pending.anchor, 10);
  assert.equal(pending.holding, true);
});

test("weather layers are not reordered for every animation opacity change", () => {
  const first = new Map([[8, 0.15], [9, 0.85]]);
  const second = new Map([[8, 0.95], [9, 0.05]]);
  const moved = new Map([[9, 0.15], [10, 0.85]]);
  assert.equal(spatialStackKey(first), spatialStackKey(second));
  assert.notEqual(spatialStackKey(first), spatialStackKey(moved));
});

test("an already prefetched future hour is not shown as the requested hour during seek", () => {
  const plan = selectSpatialFramePlan(12, 0.5, new Set([8, 13]), 8);
  assert.equal(plan.anchor, 8);
  assert.equal(plan.holding, true);
  assert.equal(plan.goals.has(13), false);
});
test("future-only spatial data must not masquerade as the current forecast hour", () => {
  const plan = selectSpatialFramePlan(12, 0.5, new Set([13]), null);
  assert.equal(plan.holding, true);
  assert.equal(plan.anchor, null);
  assert.equal(plan.goals.size, 0);
  // Future-only ECMWF cannot be misrepresented as the requested time.
});

test("live Android trace: frame 14 at blend 0.006 cannot display old frame 13 at 26.9 percent",()=>{
 const plan=selectSpatialFramePlan(14,0.006,new Set([13,14]),13);
 assert.deepEqual([...plan.goals],[[14,1]]);
 assert.equal(plan.goals.has(13),false,
   "the previous completed hour must disappear as soon as the requested hour is ready");
 const interpolated=selectSpatialFramePlan(14,0.006,new Set([13,14,15]),13);
 assert.deepEqual([...interpolated.goals],[[14,0.994],[15,0.006]]);
 assert.equal(interpolated.goals.has(13),false);
 assert.equal([...interpolated.goals.values()].reduce((a,b)=>a+b,0),1);
});

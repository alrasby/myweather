import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSpatialFramePlan } from "./modelFrameTimeline.ts";

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

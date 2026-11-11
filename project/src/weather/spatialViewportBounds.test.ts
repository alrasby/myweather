import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialViewportBounds } from "./spatialViewportBounds.ts";

test("Norway viewport requests a small padded area instead of the world", () => {
  const bounds = spatialViewportBounds({ west: 8, east: 24, south: 57, north: 72 });
  assert.ok(bounds[0] < 8 && bounds[0] > -5);
  assert.ok(bounds[2] > 24 && bounds[2] < 40);
  assert.ok(bounds[1] < 57 && bounds[3] > 72);
  assert.ok(bounds[2] - bounds[0] < 360);
});

test("Arabian Sea viewport remains regional and includes all visible edges", () => {
  const bounds = spatialViewportBounds({ west: 44, east: 75, south: 5, north: 30 });
  assert.ok(bounds[0] <= 44 && bounds[1] <= 5 && bounds[2] >= 75 && bounds[3] >= 30);
  assert.ok(bounds[2] - bounds[0] < 50);
});

test("dateline/wrapped views use correct global coverage, not a missing rectangular window", () => {
  for (const view of [
    { west: 170, east: 194, south: -10, north: 40 },
    { west: -190, east: -170, south: -10, north: 40 },
    { west: -180, east: 180, south: -80, north: 80 },
    { west: 170, east: -170, south: -10, north: 40 },
  ]) {
    const bounds = spatialViewportBounds(view);
    assert.equal(bounds[0], -180);
    assert.equal(bounds[2], 180);
  }
});

test("high latitudes remain in Web Mercator limits", () => {
  const bounds = spatialViewportBounds({ west: 5, east: 25, south: 75, north: 85 });
  assert.ok(bounds[3] <= 85.051129);
  assert.ok(bounds[1] >= -85.051129);
});

test("invalid or nonfinite viewports fail safe to global model", () => {
  const bounds = spatialViewportBounds({ west: NaN, east: 10, south: 1, north: 20 });
  assert.deepEqual(bounds.slice(0,1), [-180]);
  assert.equal(bounds[2], 180);
});

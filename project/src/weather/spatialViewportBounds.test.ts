import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialViewportBounds, canReuseSpatialWindow } from "./spatialViewportBounds.ts";

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

test("small pans inside a padded .om window do not retrigger full decoding", () => {
  const current = spatialViewportBounds({ west: 40, east: 60, south: 15, north: 30 });
  const slight = spatialViewportBounds({ west: 40.3, east: 60.3, south: 15.1, north: 30.1 });
  assert.equal(canReuseSpatialWindow(current, slight), true,
    "a tiny move can reuse most of the padded region, keeping a safety margin");
  const stillWithin = [current[0] + 0.1, current[1] + 0.1, current[2] - 0.1, current[3] - 0.1];
  assert.equal(canReuseSpatialWindow(current, stillWithin as typeof current), true);
  const shifted = spatialViewportBounds({ west: 42, east: 62, south: 15, north: 30 });
  assert.equal(canReuseSpatialWindow(current, shifted), false,
    "a move beyond half the buffered margin must refresh the crop");
  const distant = spatialViewportBounds({ west: 75, east: 95, south: 15, north: 30 });
  assert.equal(canReuseSpatialWindow(current, distant), false);
});
test("world coverage may shrink back to regional windows and cannot hide dateline data", () => {
  const world = spatialViewportBounds({ west: 170, east: 195, south: -10, north: 40 });
  const regional = spatialViewportBounds({ west: 60, east: 80, south: -10, north: 40 });
  assert.equal(canReuseSpatialWindow(world, regional), false);
  assert.equal(canReuseSpatialWindow(regional, world), false);
  assert.equal(canReuseSpatialWindow(world, world), true);
});

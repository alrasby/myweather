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

test("wrapped dateline map bounds preserve a narrow latitude band", () => {
  const wrapped = spatialViewportBounds({ west: 170, east: -170, south: 12, north: 28 });
  const unwrapped = spatialViewportBounds({ west: 170, east: 190, south: 12, north: 28 });
  assert.deepEqual(wrapped, unwrapped);
  assert.equal(wrapped[0], -180);
  assert.equal(wrapped[2], 180);
  assert.ok(wrapped[1] <= 12 && wrapped[3] >= 28);
  assert.ok(wrapped[3] - wrapped[1] < 25, "avoid decoding both polar caps");
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

test("mere padding beyond the antimeridian does not trigger a global ECMWF decode", () => {
  const b = spatialViewportBounds({ west: 157, east: 178, south: 35, north: 55 });
  assert.ok(b[0] > 140 && b[0] < 157);
  assert.equal(b[2], 180);
  assert.ok(b[2] - b[0] < 40, "retain regional window, not full 360 degrees");
  assert.ok(b[1] <= 35 && b[3] >= 55);
});

test("continuous 360-degree panning preserves equivalent small regional windows", () => {
  const view = { west: 25, east: 42, south: 10, north: 30 };
  const expected = spatialViewportBounds(view);
  assert.ok(expected[2] - expected[0] < 25);
  assert.deepEqual(spatialViewportBounds({ ...view, west: 385, east: 402 }), expected);
  assert.deepEqual(spatialViewportBounds({ ...view, west: -335, east: -318 }), expected);
  assert.deepEqual(spatialViewportBounds({ ...view, west: 745, east: 762 }), expected);
});

test("antimeridian crossing reads the full longitude but only the visible latitude band", () => {
  const b = spatialViewportBounds({ west: 172, east: 188, south: 15, north: 35 });
  assert.equal(b[0], -180);
  assert.equal(b[2], 180);
  assert.ok(b[1] <= 15 && b[1] >= 10);
  assert.ok(b[3] >= 35 && b[3] <= 40);
  assert.ok(b[3] - b[1] < 30, "do not fetch both polar caps when the map shows 20 degrees");
});

test("zoomed-out large views are global in longitude but bounded in latitude", () => {
  const b = spatialViewportBounds({ west: -162, east: 162, south: -38, north: 41 });
  assert.equal(b[0], -180);
  assert.equal(b[2], 180);
  assert.ok(b[1] <= -38 && b[3] >= 41);
  assert.ok(b[3] - b[1] < 105);
});

test("dateline longitude wraps still cover the visible latitude without full globe decodes", () => {
  const east = spatialViewportBounds({ west: 170, east: 200, south: 12, north: 27 });
  const west = spatialViewportBounds({ west: -190, east: -160, south: 12, north: 27 });
  assert.deepEqual(west, east);
  assert.ok(east[1] <= 12 && east[3] >= 27);
  assert.ok(east[3] - east[1] < 22);
});

test("genuinely whole-earth latitudes still request the whole latitudinal range", () => {
  const b = spatialViewportBounds({ west: -180, east: 180, south: -85, north: 85 });
  assert.deepEqual(b, [-180, -85.0511287798, 180, 85.0511287798]);
});

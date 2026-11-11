import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialTileOptions } from "./spatialTilePolicy.ts";

test("all ECMWF forecast layers fetch new viewport tiles during map movement", () => {
  for (const pane of ["wx-clouds", "wx-model"] as const) {
    const opts = spatialTileOptions(pane);
    assert.equal(opts.updateWhenIdle, true);
    assert.equal(opts.updateWhenZooming, false);
    assert.ok(opts.updateInterval >= 200);
    assert.equal(opts.keepBuffer, 1);
  }
});
test("ECMWF native zoom is bounded without limiting user map zoom", () => {
  const opts = spatialTileOptions("wx-clouds");
  assert.equal(opts.maxNativeZoom, 12);
  assert.equal(opts.maxZoom, 16);
});
test("clouds and precipitation share identical viewport policy", () => {
  const clouds = spatialTileOptions("wx-clouds");
  const rain = spatialTileOptions("wx-model");
  assert.deepEqual({ ...clouds, pane: "wx-model" }, rain);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { decideSpatialViewport, ECMWF_REGIONAL_MIN_ZOOM } from "./spatialViewportBudget.ts";

const view = (zoom: number, lonSpan: number, latSpan: number) => ({
  zoom, west: -15, east: -15 + lonSpan, south: -latSpan/2, north: latSpan/2,
});

test("real-world zoom 3 and zoom 5 MUST retain all real ECMWF rain/cloud/snow fields", () => {
  assert.deepEqual(decideSpatialViewport(view(3, 63.3, 108.4)),
    {allow: true, reason: "world-scale", rasterSize: 256});
  assert.deepEqual(decideSpatialViewport(view(5, 15.8, 17.5)),
    {allow: true, reason: "world-scale", rasterSize: 512});
  assert.deepEqual(decideSpatialViewport(view(5, 15.8, 25.4)),
    {allow: true, reason: "world-scale", rasterSize: 512});
  assert.equal(ECMWF_REGIONAL_MIN_ZOOM, 6);
});

test("retain native ECMWF geographic coverage while sampling density grows toward zoom 8", () => {
  assert.deepEqual(decideSpatialViewport(view(4, 16, 18)),
    {allow: true, reason: "world-scale", rasterSize: 512});
  assert.deepEqual(decideSpatialViewport(view(6, 8, 12)),
    {allow: true, reason: "regional", rasterSize: 512});
  assert.deepEqual(decideSpatialViewport(view(9, 2, 4)),
    {allow: true, reason: "regional", rasterSize: 1024});
});

test("large physical viewports downsample *real* ECMWF rather than hiding it", () => {
  assert.deepEqual(decideSpatialViewport(view(9, 65, 10)),
    {allow: true, reason: "longitude-band", rasterSize: 512});
  assert.deepEqual(decideSpatialViewport(view(9, 4, 28)),
    {allow: true, reason: "latitude-band", rasterSize: 512});
});

test("valid wrapped world copies are supported; invalid coordinates fail closed", () => {
  assert.deepEqual(decideSpatialViewport({
    zoom: 8, west: 165, east: -165, south: 15, north: 30,
  }), {allow: true, reason: "regional", rasterSize: 1024});
  assert.deepEqual(decideSpatialViewport({
    zoom: 8, west: 525, east: 555, south: 15, north: 30,
  }), {allow: true, reason: "regional", rasterSize: 1024});
  for(const v of [
    {zoom: 8, west: 0, east: 360, south: -75, north: 76},
    {zoom: 9, west: NaN, east: 20, south: 5, north: 20},
    {zoom: 9, west: 40, east: 20, south: 5, north: 20},
    {zoom: 10, west: 0, east: 10, south: 30, north: 20},
  ]) {
    const result = decideSpatialViewport(v);
    if (v.zoom === 8) assert.equal(result.allow, true,
      "entire Earth remains a valid source-backed ECMWF view");
    else assert.deepEqual(result, {allow:false, reason:"invalid", rasterSize:256});
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialTileOptions, spatialPhysicalTileSize, COMPACT_SPATIAL_TILE_SIZE, useCompactSpatialTiles } from "./spatialTilePolicy.ts";

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
test("Android without shared workers cuts ECMWF worker jobs without raster stretching", () => {
  assert.equal(useCompactSpatialTiles(true, false), true);
  assert.equal(useCompactSpatialTiles(true, true), false);
  assert.equal(useCompactSpatialTiles(false, false), false);
  const clouds = spatialTileOptions("wx-clouds", true);
  const rain = spatialTileOptions("wx-model", true);
  assert.equal(clouds.tileSize, COMPACT_SPATIAL_TILE_SIZE);
  assert.equal(clouds.zoomOffset, -2);
  assert.equal(clouds.maxNativeZoom, 13);
  assert.deepEqual({ ...clouds, pane: "wx-model" }, rain);
  const standard = spatialTileOptions("wx-clouds");
  assert.equal(standard.tileSize, 512);
  assert.equal(standard.zoomOffset, -1);
});

test("global zoom tile footprints match the bounded aligned .om data crop",()=>{
 assert.equal(spatialPhysicalTileSize(true,3),512);
 assert.equal(spatialPhysicalTileSize(true,5),512);
 assert.equal(spatialPhysicalTileSize(true,6),COMPACT_SPATIAL_TILE_SIZE);
 assert.equal(spatialPhysicalTileSize(false,4),512);
 const world=spatialTileOptions("wx-clouds",true,true);
 assert.equal(world.tileSize,512);
 assert.equal(world.zoomOffset,-1);
 assert.equal(world.keepBuffer,0);
 assert.equal(world.maxNativeZoom,12);
 const region=spatialTileOptions("wx-clouds",true,false);
 assert.equal(region.tileSize,1024);
 assert.equal(region.zoomOffset,-2);
 assert.equal(region.keepBuffer,0,
   "do not cache offscreen partial ECMWF rasters on mobile");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay, needsRasterSeamGuard, shouldKeepSatelliteParent, shouldKeepWorldSatelliteParent, SATELLITE_UNDERLAY_NATIVE_ZOOM, SATELLITE_WORLD_PARENT_NATIVE_ZOOM, snapshotSatelliteRasterCoverage } from "./satelliteBasemap.ts";

test("the world map never renders duplicate Esri raster grids", () => {
  for (const zoom of [3, 4]) assert.equal(needsSatelliteUnderlay(zoom), false);
  assert.equal(SATELLITE_UNDERLAY_NATIVE_ZOOM, 4);
});
test("the low-resolution safety underlay remains at closer zoom levels", () => {
  for (const zoom of [5, 6, 7, 12, 16]) assert.equal(needsSatelliteUnderlay(zoom), true);
  assert.equal(needsSatelliteUnderlay(Number.NaN), false);
});

test("Android raster seam mitigation excludes other browsers and low density screens", () => {
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 3), true);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Linux; Android 16)", 1), false);
  assert.equal(needsRasterSeamGuard("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 3), false);
});
test("avoid duplicate z4 parent images at world zoom and keep coarser parent at zoom5+", () => {
  for (const detailReady of [false, true]) {
    for (const zoom of [0, 3, 4]) assert.equal(shouldKeepSatelliteParent(zoom, detailReady), false);
    for (const zoom of [5, 6, 8]) assert.equal(shouldKeepSatelliteParent(zoom, detailReady), true);
  }
});

test("independent z2 real satellite parent covers black holes during broad world pans",()=>{
 assert.equal(SATELLITE_WORLD_PARENT_NATIVE_ZOOM,2);
 assert.equal(shouldKeepWorldSatelliteParent(3,false),true);
 assert.equal(shouldKeepWorldSatelliteParent(4,false),true);
 assert.equal(shouldKeepWorldSatelliteParent(5,false),true);
 assert.equal(shouldKeepWorldSatelliteParent(3,true),true,
   "keep the world parent warm after detail loads to eliminate black satellite gaps on pan");
 assert.equal(shouldKeepWorldSatelliteParent(5,true),false);
 assert.equal(shouldKeepWorldSatelliteParent(6,false),false,
   "never download a third Esri tile layer above world-scale views");
 assert.equal(shouldKeepWorldSatelliteParent(NaN,false),false);
});

test("separate satellite diagnostic rejects a stale, pending or failed Esri image", () => {
  const first = { current: true, loaded: 1, coords: { z: 3 }, el: { complete: true, naturalWidth: 256 } };
  const second = { current: true, loaded: 0, coords: { z: 3 }, el: { complete: false, naturalWidth: 0 } };
  let loading = true;
  const layer = { _tileZoom: 3, _tiles: { a: first, b: second }, isLoading: () => loading };
  assert.deepEqual(snapshotSatelliteRasterCoverage(layer, 3), {
    active: true, required: 2, delivered: 1, pending: 1,
    failed: 0, loading: true, complete: false,
  });
  second.loaded = 2;
  second.el.complete = true;
  second.el.naturalWidth = 256;
  loading = false;
  assert.equal(snapshotSatelliteRasterCoverage(layer, 3).complete, true);
  assert.equal(snapshotSatelliteRasterCoverage(layer, 4).complete, false);
  const failed = new WeakSet<object>([second.el]);
  const broken = snapshotSatelliteRasterCoverage(layer, 3, failed);
  assert.equal(broken.failed, 1);
  assert.equal(broken.complete, false);
  assert.equal(snapshotSatelliteRasterCoverage(null, 3).active, false);
});

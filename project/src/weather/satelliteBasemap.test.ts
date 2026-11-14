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

test("satellite viewport detects missing uncreated images despite loaded cached tiles", () => {
  const image = (width: number) => ({ complete: width > 0, naturalWidth: width });
  const first = { current: true, loaded: 1, coords: { x: 0, y: 0, z: 3 }, el: image(256) };
  const second = { current: true, loaded: 2, coords: { x: 1, y: 0, z: 3 }, el: image(256) };
  let busy = false;
  const layer = {
    _tileZoom: 3,
    _tiles: { first, second },
    isLoading: () => busy,
  };
  const twoTiles = { minX: 0, maxX: 512, minY: 0, maxY: 256, tileWidth: 256, tileHeight: 256 };
  assert.deepEqual(snapshotSatelliteRasterCoverage(layer, 3, undefined, twoTiles), {
    active: true, required: 2, delivered: 2, pending: 0, missing: 0,
    failed: 0, loading: false, complete: true,
  });
  // The previous implementation looked only at tile.current, so a second
  // missing row of the real viewport incorrectly reported complete=true.
  const fullScreen = { ...twoTiles, maxY: 512 };
  const torn = snapshotSatelliteRasterCoverage(layer, 3, undefined, fullScreen);
  assert.equal(torn.required, 4);
  assert.equal(torn.delivered, 2);
  assert.equal(torn.missing, 2);
  assert.equal(torn.complete, false);
  busy = true;
  assert.equal(snapshotSatelliteRasterCoverage(layer, 3, undefined, twoTiles).complete, false);
  busy = false;
  assert.equal(snapshotSatelliteRasterCoverage(layer, 4, undefined, twoTiles).complete, false);
  const failed = new WeakSet<object>([second.el]);
  assert.deepEqual(snapshotSatelliteRasterCoverage(layer, 3, failed, twoTiles), {
    active: true, required: 2, delivered: 1, pending: 0, missing: 0,
    failed: 1, loading: false, complete: false,
  });
  assert.equal(snapshotSatelliteRasterCoverage(null, 3, undefined, twoTiles).active, false);
});
test("satellite viewport follows repeated westward world copies and ignores offscreen cache", () => {
  const img = { complete: true, naturalWidth: 256 };
  const layer = {
    _tileZoom: 3,
    _tiles: {
      old: { current: true, loaded: 1, coords: { x: 0, y: 0, z: 3 }, el: img },
      west: { current: true, loaded: 2, coords: { x: -9, y: 0, z: 3 }, el: img },
    },
    isLoading: () => false,
  };
  const west = { minX: -9 * 256, maxX: -8 * 256, minY: 0, maxY: 256,
    tileWidth: 256, tileHeight: 256 };
  assert.equal(snapshotSatelliteRasterCoverage(layer, 3, undefined, west).complete, true);
  const further = { ...west, minX: -10 * 256 };
  const partial = snapshotSatelliteRasterCoverage(layer, 3, undefined, further);
  assert.equal(partial.missing, 1);
  assert.equal(partial.complete, false);
  const polar = { ...west, minY: -256, maxY: 256 };
  assert.equal(snapshotSatelliteRasterCoverage(layer, 3, undefined, polar).required, 1,
    "imagery beyond north pole is not a valid Esri Mercator tile");
});

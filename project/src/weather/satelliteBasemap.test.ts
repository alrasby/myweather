import assert from "node:assert/strict";
import { test } from "node:test";
import { needsSatelliteUnderlay, needsRasterSeamGuard, shouldKeepSatelliteParent, shouldKeepWorldSatelliteParent, SATELLITE_UNDERLAY_NATIVE_ZOOM, SATELLITE_WORLD_PARENT_NATIVE_ZOOM, satelliteHandoffDecision, snapshotSatelliteRasterCoverage } from "./satelliteBasemap.ts";

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
  assert.equal(snapshotSatelliteRasterCoverage(layer, 2, undefined, twoTiles).complete, false, "a native z3 layer cannot certify a lower zoom2 map");
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

test("real native-z2 parent imagery covers zoom4 map when pixel scale is respected", () => {
 const el={complete:true,naturalWidth:256};
 const layer={_tileZoom:2,isLoading:()=>false,_tiles:{
  a:{current:true,loaded:1,coords:{x:0,y:0,z:2},el},
  b:{current:true,loaded:1,coords:{x:1,y:0,z:2},el},
 }};
 const region={minX:0,maxX:2048,minY:0,maxY:1024,tileWidth:256,tileHeight:256};
 const ok=snapshotSatelliteRasterCoverage(layer,4,undefined,region);
 assert.equal(ok.required,2);
 assert.equal(ok.complete,true);
 assert.equal(snapshotSatelliteRasterCoverage(layer,1,undefined,region).complete,false);
 const shifted=snapshotSatelliteRasterCoverage(layer,4,undefined,{...region,maxX:3072});
 assert.equal(shifted.missing,1);
 assert.equal(shifted.complete,false);
});

test("pinch keeps already mounted real Esri parents until the CSS zoom settles",()=>{
 const base={zoom:4,zooming:true,mountedWorld:true,mountedUnderlay:true,
   detailComplete:false,underlayComplete:false,worldComplete:false};
 assert.deepEqual(satelliteHandoffDecision(base),{
   underlay:true,worldParent:true,
 });
 assert.deepEqual(satelliteHandoffDecision({...base,zoom:6,mountedWorld:false}),{
   underlay:true,worldParent:true,
 },"warm the existing tiny z2 Esri source during an Android pinch starting at z6");
 assert.deepEqual(satelliteHandoffDecision({...base,zoom:3,mountedUnderlay:false}),{
   underlay:false,worldParent:true,
 },"do not download duplicate z3 detail URLs during world pinch");
});
test("low-zoom handoff never removes the z4 source until a REAL z2/detail viewport covers the screen",()=>{
 const state={zoom:4,zooming:false,mountedWorld:true,mountedUnderlay:true,
   detailComplete:false,underlayComplete:false,worldComplete:false};
 assert.deepEqual(satelliteHandoffDecision(state),{underlay:true,worldParent:true});
 assert.deepEqual(satelliteHandoffDecision({...state,worldComplete:true}),
   {underlay:false,worldParent:true});
 assert.deepEqual(satelliteHandoffDecision({...state,detailComplete:true}),
   {underlay:false,worldParent:true});
 assert.deepEqual(satelliteHandoffDecision({...state,mountedUnderlay:false}),
   {underlay:false,worldParent:true},
   "do not mount a redundant z3/4 underlay when both protectors are missing");
});
test("z5 and closer map levels retain a z2 parent only until actual z4 or detailed pixels arrive",()=>{
 const state={zoom:5,zooming:false,mountedWorld:true,mountedUnderlay:true,
   detailComplete:false,underlayComplete:false,worldComplete:false};
 assert.deepEqual(satelliteHandoffDecision(state),{underlay:true,worldParent:true});
 assert.deepEqual(satelliteHandoffDecision({...state,underlayComplete:true}),
   {underlay:true,worldParent:false});
 assert.deepEqual(satelliteHandoffDecision({...state,detailComplete:true}),
   {underlay:true,worldParent:false});
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:6,mountedWorld:false}),
   {underlay:true,worldParent:true},
   "cover a long z6 pan with one real tiny z2 source grid while z4/detailed imagery is missing");
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:6,mountedWorld:false,underlayComplete:true}),
   {underlay:true,worldParent:false},
   "release extra z2 once genuinely visible z4 source covers zoom6");
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:7}),
   {underlay:true,worldParent:true},
   "briefly retain the already-mounted real parent if the new zoom has no z4 coverage");
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:7,mountedWorld:false}),
   {underlay:true,worldParent:false},
   "never create an unnecessary third Esri layer at high zoom");
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:7,underlayComplete:true}),
   {underlay:true,worldParent:false});
});
test("Esri handoff never invents new source imagery for invalid map geometry",()=>{
 const state={zoom:NaN,zooming:false,mountedWorld:false,mountedUnderlay:true,
   detailComplete:false,underlayComplete:false,worldComplete:false};
 assert.deepEqual(satelliteHandoffDecision(state),{underlay:true,worldParent:false});
 assert.deepEqual(satelliteHandoffDecision({...state,zoom:-1}),
   {underlay:true,worldParent:false});
});

test("queue-drain cannot detach authentic z2 background until viewport has actual z4 pixels",()=>{
 const img={complete:true,naturalWidth:256};
 const view={minX:0,maxX:512,minY:0,maxY:256,tileWidth:256,tileHeight:256};
 const detail={_tileZoom:5,_tiles:{
   first:{current:true,loaded:1,coords:{x:0,y:0,z:5},el:img},
 },isLoading:()=>false};
 const underlay={_tileZoom:4,_tiles:{} as Record<string,unknown>,isLoading:()=>false};
 const world={_tileZoom:2,_tiles:{
   earth:{current:true,loaded:1,coords:{x:0,y:0,z:2},el:img},
 },isLoading:()=>false};
 const coverage=()=>{
   const fine=snapshotSatelliteRasterCoverage(detail,5,undefined,view);
   const low=snapshotSatelliteRasterCoverage(underlay,5,undefined,view);
   const globe=snapshotSatelliteRasterCoverage(world,5,undefined,view);
   return satelliteHandoffDecision({zoom:5,zooming:false,mountedUnderlay:true,
     mountedWorld:true,detailComplete:fine.complete,
     underlayComplete:low.complete,worldComplete:globe.complete});
 };
 assert.equal(snapshotSatelliteRasterCoverage(detail,5,undefined,view).complete,false,
   "Leaflet load with one actual tile is not complete for two required grid cells");
 assert.equal(snapshotSatelliteRasterCoverage(world,5,undefined,view).complete,true);
 assert.deepEqual(coverage(),{underlay:true,worldParent:true},
   "never discard a source-backed parent solely due to a drained fine request queue");
 underlay._tiles={ready:{current:true,loaded:2,coords:{x:0,y:0,z:4},el:img}};
 assert.equal(snapshotSatelliteRasterCoverage(underlay,5,undefined,view).complete,true);
 assert.deepEqual(coverage(),{underlay:true,worldParent:false},
   "remove the extra z2 source only after new native-z4 imagery covers all screen cells");
});

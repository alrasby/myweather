import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyViewportFailure, parseSpatialRasterTile, shouldUseViewportWorker, SpatialViewportRenderer } from "./spatialViewportRenderer.ts";
import { SpatialAdmissionError } from "./spatialRenderAdmission.ts";

const base = "om://https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/11/12/0000Z/2026-11-12T1200.om";

test("viewport raster parser preserves requested run, variable and tile coords", () => {
  const url = base + "?variable=cloud_cover&interpolation=linear&color_blend=true&tile_size=1024/8/112/89";
  const parsed = parseSpatialRasterTile(url);
  assert.ok(parsed);
  assert.equal(parsed.file, base.slice(5));
  assert.equal(parsed.variable, "cloud_cover");
  assert.deepEqual(parsed.tile, { z: 8, x: 112, y: 89, size: 1024 });
  assert.ok(parsed.key.endsWith("tile_size=1024"));
  assert.equal(parseSpatialRasterTile(base + "?variable=wind_speed&tile_size=1024/8/1/2"), null);
  assert.equal(parseSpatialRasterTile(base + "?variable=precipitation/NaN/1/2"), null);
  assert.equal(parseSpatialRasterTile(base + "?variable=snowfall_water_equivalent&tile_size=2048/8/1/2"), null);
});

test("custom worker is Android-only and has a predictable legacy rollback", () => {
  assert.equal(shouldUseViewportWorker(true, false, true, false), true);
  assert.equal(shouldUseViewportWorker(true, true, true, false), false);
  assert.equal(shouldUseViewportWorker(false, false, true, false), false);
  assert.equal(shouldUseViewportWorker(true, false, false, false), false);
  assert.equal(shouldUseViewportWorker(true, false, true, true), false);
});

test("worker renderer in unsupported runtimes reports legacy without starting jobs", () => {
  const renderer = new SpatialViewportRenderer(false);
  assert.equal(renderer.snapshot().mode, "legacy");
  assert.equal(renderer.snapshot().workerTiles, 0);
  assert.equal(renderer.snapshot().fallbackTiles, 0);
  assert.equal(renderer.snapshot().peakWaiting, 0);
  assert.ok(Object.values(renderer.snapshot().reasons).every(v => v === 0));
  renderer.dispose();
});

test("worker backpressure and data/memory failure categories are independently observable", () => {
  assert.equal(classifyViewportFailure(new SpatialAdmissionError("saturated")), "admissionSaturated");
  assert.equal(classifyViewportFailure(new SpatialAdmissionError("deadline")), "admissionDeadline");
  assert.equal(classifyViewportFailure(new SpatialAdmissionError("closed")), "workerFailure");
  assert.equal(classifyViewportFailure(new Error("viewport-worker-timeout")), "workerFailure");
  assert.equal(classifyViewportFailure(new Error("unclassified-protocol-error")), "other");
});

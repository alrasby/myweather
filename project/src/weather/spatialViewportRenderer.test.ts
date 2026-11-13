import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyViewportFailure, parseSpatialRasterTile, shouldUseViewportWorker, SpatialViewportRenderer, MAX_WORKER_DATA, ECMWF_IFS_FULL_GRID_BYTES, resolveCurrentSpatialState, SPATIAL_WORKER_VARIABLES, MAX_ACTIVE_SPATIAL_WORKERS, nextSpatialWorkerJob } from "./spatialViewportRenderer.ts";
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

test("full reduced-Gaussian ECMWF IFS model data fits the bounded new raster worker", () => {
  assert.equal(ECMWF_IFS_FULL_GRID_BYTES, 26_398_720);
  assert.ok(ECMWF_IFS_FULL_GRID_BYTES > 24 * 1024 * 1024,
    "24 MiB used to route full real-data fields to legacy rendering");
  assert.equal(MAX_WORKER_DATA, 32 * 1024 * 1024);
  assert.ok(ECMWF_IFS_FULL_GRID_BYTES < MAX_WORKER_DATA);
  assert.ok(MAX_WORKER_DATA <= 32 * 1024 * 1024, "worker memory must remain bounded");
});

test("viewport data state is resolved AFTER upstream validates the new map bounds", async () => {
  const oldState = { name: "stale-north-atlantic-window" };
  const newState = { name: "latest-europe-window" };
  let state = oldState;
  const calls: string[] = [];
  const selected = await resolveCurrentSpatialState(
    async () => { calls.push("upstream-data-revalidated"); state = newState; },
    () => { calls.push("lookup"); return state; },
  );
  assert.equal(selected, newState);
  assert.deepEqual(calls, ["upstream-data-revalidated", "lookup"]);
  await assert.rejects(
    resolveCurrentSpatialState(async () => { throw new Error("source-failed"); }, () => oldState),
    /source-failed/,
    "a failed current viewport must never silently reuse stale data",
  );
});

test("three resident variables are scheduled fairly with two active render jobs", () => {
  assert.deepEqual([...SPATIAL_WORKER_VARIABLES],
    ["cloud_cover", "precipitation", "snowfall_water_equivalent"]);
  assert.equal(MAX_ACTIVE_SPATIAL_WORKERS, 2);
  assert.equal(MAX_WORKER_DATA * SPATIAL_WORKER_VARIABLES.length, 96 * 1048576);
  const slots = [
    { variable: "cloud_cover" as const, busy: true },
    { variable: "precipitation" as const, busy: false },
    { variable: "snowfall_water_equivalent" as const, busy: false },
  ];
  const jobs = [
    { variable: "cloud_cover" as const },
    { variable: "snowfall_water_equivalent" as const },
    { variable: "precipitation" as const },
  ];
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots), { job: 1, slot: 2 });
  slots[2]!.busy = true;
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots), { job: 2, slot: 1 });
  slots[1]!.busy = true;
  assert.equal(nextSpatialWorkerJob(jobs, slots), null);
});

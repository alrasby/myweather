import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyViewportFailure, parseSpatialRasterTile, shouldUseViewportWorker, SpatialViewportRenderer, MAX_WORKER_DATA, ECMWF_IFS_FULL_GRID_BYTES, resolveCurrentSpatialState, chooseLoadedSpatialState, SPATIAL_WORKER_VARIABLES, MAX_ACTIVE_SPATIAL_WORKERS, nextSpatialWorkerJob } from "./spatialViewportRenderer.ts";
import { SpatialAdmissionError } from "./spatialRenderAdmission.ts";

const base = "om://https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/11/12/0000Z/2026-11-12T1200.om";

test("viewport raster parser preserves requested run, variable and tile coords", () => {
  const url = base + "?variable=cloud_cover&interpolation=linear&color_blend=true&tile_size=1024/8/112/89";
  const parsed = parseSpatialRasterTile(url);
  assert.ok(parsed);
  assert.equal(parsed.file, base.slice(5));
  assert.equal(parsed.variable, "cloud_cover");
  assert.deepEqual(parsed.tile, { z: 8, x: 112, y: 89, size: 1024 });
  assert.equal(parsed.frame, null);
  assert.equal(parseSpatialRasterTile(base + "?time_step=valid_times_22&variable=cloud_cover&tile_size=1024/8/112/89")?.frame, 22);
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

test("request-scoped ECMWF data survives a concurrent state-map replacement", () => {
  const filename = base.slice(5);
  const read = { omFileUrl: filename, dataOptions: { variable: "cloud_cover" },
    data: { values: new Float32Array([8, 9]) } };
  const pending = { omFileUrl: filename, dataOptions: { variable: "cloud_cover" }, data: null };
  assert.equal(chooseLoadedSpatialState(read as never, [pending as never], filename, "cloud_cover"), read);
  assert.equal(chooseLoadedSpatialState(null, [pending as never], filename, "cloud_cover"), null);
  assert.equal(chooseLoadedSpatialState(read as never, [], filename, "precipitation"), null);
  assert.equal(chooseLoadedSpatialState(null, [read as never], filename, "cloud_cover"), read);
});

test("raster queue preserves hot forecast data without starving earlier hours", () => {
  const slots = [
    { variable: "cloud_cover" as const, busy: false, cache: new Map([["hour-17", 100]]) },
    { variable: "precipitation" as const, busy: true },
    { variable: "snowfall_water_equivalent" as const, busy: true },
  ];
  const jobs = [
    { variable: "cloud_cover" as const, dataKey: "hour-18", queuedAt: 100 },
    { variable: "cloud_cover" as const, dataKey: "hour-17", queuedAt: 140 },
  ];
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots, 300), { job: 1, slot: 0 });
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots, 650), { job: 0, slot: 0 });
  assert.deepEqual(nextSpatialWorkerJob(jobs.slice(0, 1), slots, 200), { job: 0, slot: 0 });
});
\n
test("requested hour beats queued future-hour raster and future work resumes", () => {
  const slots = [
    { variable: "cloud_cover" as const, busy: false },
    { variable: "precipitation" as const, busy: false },
    { variable: "snowfall_water_equivalent" as const, busy: false },
  ];
  const jobs = [
    { variable: "cloud_cover" as const, frame: 23, queuedAt: 100 },
    { variable: "precipitation" as const, frame: 22, queuedAt: 120 },
  ];
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots, 200, 22), { job: 1, slot: 1 });
  assert.deepEqual(nextSpatialWorkerJob(jobs.slice(0, 1), slots, 200, 22), { job: 0, slot: 0 });
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots, 200, null), { job: 0, slot: 0 });
  slots[1]!.busy = true;
  assert.deepEqual(nextSpatialWorkerJob(jobs, slots, 200, 22), { job: 0, slot: 0 });
});

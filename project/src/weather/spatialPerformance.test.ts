import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialPerformance, summarizeDurations } from "./spatialPerformance.ts";
test("separates network/queue timings from full tile decoding and painting", () => {
  const profiler = new SpatialPerformance();
  profiler.networkRequest(17, 180, 2048, true);
  profiler.networkRequest(24, 320, 1024, false);
  profiler.tile(0, 650, true);
  profiler.tile(1, 1100, true);
  profiler.tile(2, 500, false);
  const s = profiler.snapshot(false, 15 * 1048576);
  assert.equal(s.nativeNetwork.p95Ms, 320);
  assert.equal(s.nativeQueue.p50Ms, 17);
  assert.equal(s.nativeFailures, 1);
  assert.equal(s.nativeBytes, 3072);
  assert.equal(s.tilePipeline[0].p95Ms, 650);
  assert.equal(s.tilePipeline[2].count, 0);
  assert.equal(s.tileFailures[2], 1);
  assert.equal(s.runtime.heapUsedMb, 15);
  assert.equal(s.runtime.crossOriginIsolated, false);
});
test("latency samples bounded to avoid diagnostic memory growth", () => {
  const p = new SpatialPerformance();
  for (let n = 0; n < 2000; n++) {
    p.networkRequest(n, n * 2, 10, true);
    p.tile(0, n, true);
  }
  const s = p.snapshot(true, null);
  assert.equal(s.nativeNetwork.count, 120);
  assert.equal(s.tilePipeline[0].count, 120);
  assert.equal(s.nativeBytes, 20000);
  assert.equal(s.runtime.heapUsedMb, null);
});
test("percentiles are deterministic and empty probes never invent observations", () => {
  assert.deepEqual(summarizeDurations([]), { count:0, p50Ms:null, p95Ms:null, maxMs:null });
  assert.deepEqual(summarizeDurations([10,20,30,40,50,NaN,-3]), { count:5, p50Ms:30, p95Ms:50, maxMs:50 });
});

test("cancelled tile requests are not mislabeled as network failures", () => {
  const p = new SpatialPerformance();
  p.networkRequest(20, 10, 0, false, true);
  p.networkRequest(30, 20, 0, false);
  const snap = p.snapshot(false, null);
  assert.equal(snap.nativeCancellations, 1);
  assert.equal(snap.nativeFailures, 1);
});

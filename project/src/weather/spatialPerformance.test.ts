import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialPerformance } from "./spatialPerformance.ts";
test("separates network, queue, protocol tile and Leaflet delivery timings", () => {
  const m = new SpatialPerformance(4);
  m.observe("network", 100);
  m.observe("nativeQueue", 20);
  m.observe("browserRetry", 12000);
  m.observe("workerTile", 200);
  m.observe("leafletTile", 230);
  const s = m.snapshot();
  assert.equal(s.network.meanMs, 100);
  assert.equal(s.nativeQueue.meanMs, 20);
  assert.equal(s.browserRetry.meanMs, 12000);
  assert.equal(s.workerTile.meanMs, 200);
  assert.equal(s.leafletTile.meanMs, 230);
});
test("the rolling percentile is bounded but count/mean represent the full session", () => {
  const m = new SpatialPerformance(3);
  [20,40,60,80].forEach(x => m.observe("network", x));
  const s = m.snapshot().network;
  assert.equal(s.count, 4);
  assert.equal(s.meanMs, 50);
  assert.equal(s.p95Ms, 80);
});
test("invalid and absent samples never fabricate latency", () => {
  const m = new SpatialPerformance();
  m.observe("network", Number.NaN);
  m.observe("network", -10);
  assert.deepEqual(m.snapshot().network, { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0 });
});

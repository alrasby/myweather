import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialNativeQueue, spatialNativePriority } from "./spatialNativeQueue.ts";

test("native spatial HTTP cannot exceed its concurrency limit", async () => {
  const queue = new SpatialNativeQueue(2);
  const releases: Array<() => void> = [];
  let running = 0;
  let peak = 0;
  const job = () => queue.run(undefined, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running--;
  });
  const tasks = [job(), job(), job(), job()];
  assert.equal(running, 2);
  releases.shift()!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(running, 2);
  for (let n = 0; n < 3; n++) {
    releases.shift()!();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await Promise.all(tasks);
  assert.equal(peak, 2);
});
test("abandoned frame tasks waiting for native HTTP are skipped", async () => {
  const queue = new SpatialNativeQueue(1);
  let finishFirst!: () => void;
  const first = queue.run(undefined, () => new Promise<void>((resolve) => { finishFirst = resolve; }));
  const abort = new AbortController();
  let entered = false;
  const second = queue.run(abort.signal, async () => { entered = true; });
  abort.abort();
  await assert.rejects(second, /spatial-request-aborted/);
  finishFirst();
  await first;
  assert.equal(entered, false);
});
test("cancelling during native HTTP discards its late response", async () => {
  const queue = new SpatialNativeQueue(1);
  const abort = new AbortController();
  let finish!: (value: string) => void;
  const job = queue.run(abort.signal, () => new Promise<string>((resolve) => { finish = resolve; }));
  abort.abort();
  finish("obsolete");
  await assert.rejects(job, /spatial-request-aborted/);
});
\n
test("only actual ECMWF cloud and rain files receive native queue priority", () => {
  assert.equal(spatialNativePriority("https://s3.example/data/cloud_cover/2026.om"), 1);
  assert.equal(spatialNativePriority("https://s3.example/data/precipitation/2026.om"), 1);
  assert.equal(spatialNativePriority("om://example/model.om?variable=cloud_cover"), 1);
  assert.equal(spatialNativePriority("https://s3.example/data/snowfall_water_equivalent/2026.om"), 0);
  assert.equal(spatialNativePriority("https://s3.example/data/latest.json"), 0);
});

test("visible cloud/rain queued reads lead, but snow reads cannot starve", async () => {
  const queue = new SpatialNativeQueue(1);
  let unblock!: () => void;
  const first = queue.run(undefined, () => new Promise<void>((resolve) => { unblock = resolve; }));
  const observed: string[] = [];
  const pending: Array<[string, 0 | 1]> = [
    ["snow-a", 0], ["snow-b", 0],
    ["cloud-a", 1], ["rain-a", 1], ["cloud-b", 1], ["rain-b", 1],
  ];
  const jobs = pending.map(([name, priority]) =>
    queue.run(undefined, async () => { observed.push(name); }, priority));
  unblock();
  await Promise.all([first, ...jobs]);
  assert.deepEqual(observed.slice(0, 4), ["cloud-a", "rain-a", "cloud-b", "snow-a"]);
  assert.deepEqual(observed.slice(4), ["rain-b", "snow-b"]);
});

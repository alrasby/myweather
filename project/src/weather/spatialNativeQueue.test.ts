import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialNativeQueue } from "./spatialNativeQueue.ts";

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

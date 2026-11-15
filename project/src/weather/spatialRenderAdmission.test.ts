import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialAdmissionError, SpatialRenderAdmission } from "./spatialRenderAdmission.ts";

test("worker admission back-pressures instead of immediately running legacy tiles", async () => {
  const gate = new SpatialRenderAdmission(1, 2, 1000);
  const one = await gate.acquire(new AbortController().signal);
  let secondRunning = false;
  const two = gate.acquire(new AbortController().signal).then((release) => {
    secondRunning = true;
    return release;
  });
  assert.equal(gate.active, 1);
  assert.equal(gate.waiting, 1);
  assert.equal(secondRunning, false);
  one();
  const releaseTwo = await two;
  assert.equal(secondRunning, true);
  assert.equal(gate.active, 1);
  assert.equal(gate.waiting, 0);
  releaseTwo();
  releaseTwo();
  assert.equal(gate.active, 0);
  gate.close();
});

test("obsolete pan jobs leave the queue on abort, never consuming worker capacity", async () => {
  const gate = new SpatialRenderAdmission(1, 2, 1000);
  const release = await gate.acquire(new AbortController().signal);
  const aborted = new AbortController();
  const stale = gate.acquire(aborted.signal);
  assert.equal(gate.waiting, 1);
  aborted.abort();
  await assert.rejects(stale, (err: unknown) => err instanceof Error && err.name === "AbortError");
  assert.equal(gate.waiting, 0);
  release();
  const next = await gate.acquire(new AbortController().signal);
  next();
  gate.close();
});

test("admission remains memory-bounded with reason-coded overflow and timeout", async () => {
  const gate = new SpatialRenderAdmission(1, 1, 30);
  const release = await gate.acquire(new AbortController().signal);
  const queued = gate.acquire(new AbortController().signal);
  await assert.rejects(gate.acquire(new AbortController().signal),
    (err: unknown) => err instanceof SpatialAdmissionError && err.reason === "saturated");
  await assert.rejects(queued,
    (err: unknown) => err instanceof SpatialAdmissionError && err.reason === "deadline");
  assert.equal(gate.peakWaiting, 1);
  release();
  gate.close();
  await assert.rejects(gate.acquire(new AbortController().signal),
    (err: unknown) => err instanceof SpatialAdmissionError && err.reason === "closed");
});

test("closing a renderer rejects every waiting tile with no orphaned promise", async () => {
  const gate = new SpatialRenderAdmission(1, 3, 1000);
  const release = await gate.acquire(new AbortController().signal);
  const p1 = gate.acquire(new AbortController().signal);
  const p2 = gate.acquire(new AbortController().signal);
  gate.close();
  await Promise.all([p1, p2].map(p => assert.rejects(p, SpatialAdmissionError)));
  release();
  assert.equal(gate.active, 0);
  assert.equal(gate.waiting, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialRangeFlights } from "./spatialRangeFlights.ts";

test("concurrent duplicate OM byte ranges share a single native read", async () => {
  const flights = new SpatialRangeFlights<number>();
  let starts = 0;
  let finish!: (value: number) => void;
  const job = async () => {
    starts++;
    return new Promise<number>((resolve) => { finish = resolve; });
  };
  const one = flights.run("model.om|bytes=0-100", undefined, job);
  const two = flights.run("model.om|bytes=0-100", undefined, job);
  const three = flights.run("model.om|bytes=100-200", undefined, async () => 2);
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(flights.joined, 1);
  finish(42);
  assert.deepEqual(await Promise.all([one, two, three]), [42, 42, 2]);
  assert.equal(flights.active, 0);
});

test("aborting one duplicate does not cancel the request for remaining users", async () => {
  const flights = new SpatialRangeFlights<string>();
  const firstAbort = new AbortController();
  let finish!: (value: string) => void;
  let sharedSignal!: AbortSignal;
  const first = flights.run("same", firstAbort.signal, async (signal) => {
    sharedSignal = signal;
    return new Promise<string>((resolve) => { finish = resolve; });
  });
  const second = flights.run("same", undefined, async () => "incorrect");
  await Promise.resolve();
  firstAbort.abort();
  await assert.rejects(first, /spatial-request-aborted/);
  assert.equal(sharedSignal.aborted, false);
  finish("correct");
  assert.equal(await second, "correct");
});

test("when all callers cancel, stale result cannot be served to a later caller", async () => {
  const flights = new SpatialRangeFlights<string>();
  const a = new AbortController();
  const b = new AbortController();
  let oldSignal!: AbortSignal;
  let finishOld!: (value: string) => void;
  const work = async (signal: AbortSignal) => {
    oldSignal = signal;
    return new Promise<string>((resolve) => { finishOld = resolve; });
  };
  const one = flights.run("x", a.signal, work);
  const two = flights.run("x", b.signal, work);
  await Promise.resolve();
  a.abort(); b.abort();
  await Promise.all([assert.rejects(one, /spatial-request-aborted/), assert.rejects(two, /spatial-request-aborted/)]);
  assert.equal(oldSignal.aborted, true);
  assert.equal(flights.active, 0);
  const fresh = await flights.run("x", undefined, async () => "fresh");
  assert.equal(fresh, "fresh");
  finishOld("stale");
});

test("failed native requests clear the flight so a retry can run", async () => {
  const flights = new SpatialRangeFlights<string>();
  await assert.rejects(flights.run("x", undefined, async () => { throw new Error("native unavailable"); }), /native unavailable/);
  assert.equal(await flights.run("x", undefined, async () => "retried"), "retried");
});

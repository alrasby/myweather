import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestSlots, raceRequestTimeout } from "./requestSlots.ts";

test("aborting queued weather requests removes them and grants next slot", async () => {
  const slots = new RequestSlots(1, 3);
  const release = await slots.acquire();
  const c = new AbortController();
  const abandoned = slots.acquire(c.signal);
  const next = slots.acquire();
  assert.equal(slots.queued, 2);
  c.abort();
  await assert.rejects(abandoned, { name: "AbortError" });
  assert.equal(slots.queued, 1);
  release();
  const free = await next;
  assert.equal(slots.queued, 0);
  assert.equal(slots.running, 1);
  free(); free();
  assert.equal(slots.running, 0);
});

test("bounded queue rejects excess requests rather than leaking memory", async () => {
  const slots = new RequestSlots(1, 1);
  const release = await slots.acquire();
  const waiting = slots.acquire();
  await assert.rejects(slots.acquire(), /queue-full/);
  release();
  (await waiting)();
  assert.equal(slots.running, 0);
});

test("request timeout and abort end promptly without leaving listeners", async () => {
  await assert.rejects(
    raceRequestTimeout(new Promise<never>(() => {}), 8),
    /proxy-timeout/,
  );
  const abort = new AbortController();
  const waiting = raceRequestTimeout(new Promise<never>(() => {}), 2000, abort.signal);
  abort.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(await raceRequestTimeout(Promise.resolve("ok"), 200), "ok");
});

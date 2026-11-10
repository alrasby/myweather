import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialRangeCache } from "./spatialRangeCache.ts";

const entry = (length: number) => ({ status: 206 as const, bytes: new Uint8Array(length), headers: { "content-range": "bytes 0-3/99" } });

test("reuses verified spatial file ranges for repeated viewport reads", () => {
  const c = new SpatialRangeCache(20, 10, 100);
  c.put("url|bytes=0-3", entry(4), 100);
  assert.equal(c.get("url|bytes=0-3", 110)?.bytes.length, 4);
  assert.equal(c.get("url|bytes=4-7", 110), null);
});

test("cached ECMWF ranges expire promptly", () => {
  const c = new SpatialRangeCache(20, 10, 100);
  c.put("same", entry(4), 200);
  assert.equal(c.get("same", 299)?.bytes.length, 4);
  assert.equal(c.get("same", 300), null);
});

test("bounded LRU discards oldest ranges and rejects giant blocks", () => {
  const c = new SpatialRangeCache(10, 6, 100);
  c.put("a", entry(5), 1);
  c.put("b", entry(5), 1);
  c.get("a", 2);
  c.put("c", entry(5), 2);
  assert.equal(c.get("b", 3), null);
  assert.equal(c.get("a", 3)?.bytes.length, 5);
  assert.equal(c.get("c", 3)?.bytes.length, 5);
  c.put("giant", entry(8), 4);
  assert.equal(c.get("giant", 5), null);
});

test("cached buffers are copies, not caller-owned mutable storage", () => {
  const c = new SpatialRangeCache(10, 10, 100);
  const item = entry(4);
  c.put("x", item, 5);
  item.bytes[0] = 99;
  assert.equal(c.get("x", 6)?.bytes[0], 0);
});

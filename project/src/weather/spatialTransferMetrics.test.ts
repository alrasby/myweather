import assert from "node:assert/strict";
import { test } from "node:test";
import { spatialTransferBytes } from "./spatialTransferMetrics.ts";

test("HEAD model-file length never counts as bytes transferred", () => {
  assert.equal(spatialTransferBytes("HEAD", 200, { "Content-Length": "800000000" }, null), 0);
});

test("partial range bytes measure only requested payload, not full model size", () => {
  assert.equal(spatialTransferBytes("GET", 206,
    { "Content-Range": "bytes 100-199/800000000", "Content-Length": "800000000" }, null), 100);
});

test("native array buffer measures delivered body even if server advertises full file", () => {
  assert.equal(spatialTransferBytes("GET", 206,
    { "Content-Length": "800000000" }, new Uint8Array(4096)), 4096);
});

test("invalid response headers cannot inflate native transferred byte counts", () => {
  assert.equal(spatialTransferBytes("GET", 206, { "Content-Range": "invalid" }, null), 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrecipitationTile, modelTileFrameReady } from "./modelTileReadiness.ts";

test("rain/snow frame stays hidden until both tile queues complete", () => {
  assert.equal(modelTileFrameReady(false, [true, true], new Set()), false);
  assert.equal(modelTileFrameReady(true, [true, false], new Set()), false);
  assert.equal(modelTileFrameReady(true, [true, true], new Set()), true);
});

test("failed and incomplete spatial tiles retain global weather field", () => {
  assert.equal(modelTileFrameReady(true, [true, true], new Set([0])), false);
  assert.equal(modelTileFrameReady(true, [true], new Set()), false);
  assert.equal(modelTileFrameReady(true, [true, true, true], new Set()), false);
});

test("only rain and snow tiles qualify; cloud cover uses continuous grid", () => {
  assert.equal(isPrecipitationTile(0), true);
  assert.equal(isPrecipitationTile(1), true);
  assert.equal(isPrecipitationTile(2), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { SpatialRenderGeneration } from "./spatialRenderGeneration.ts";

test("one ECMWF viewport generation holds until all loading variables finish", () => {
  const gate = new SpatialRenderGeneration();
  const e1 = gate.begin();
  const cloud = gate.loading(0), rain = gate.loading(1), snow = gate.loading(2);
  assert.equal(cloud, e1);
  assert.equal(gate.loaded(0, cloud), true);
  assert.equal(gate.ready(), false);
  gate.loaded(2, snow);
  assert.equal(gate.ready(), false);
  gate.loaded(1, rain);
  assert.equal(gate.ready(), true);
  assert.equal(gate.pending, 0);
});

test("a pan or zoom invalidates old layer completions before next viewport can publish", () => {
  const gate = new SpatialRenderGeneration();
  const first = gate.begin();
  gate.loading(0); gate.loading(1); gate.loading(2);
  gate.loaded(0, first);
  const second = gate.begin();
  gate.loading(0);
  assert.equal(gate.loaded(1, first), false, "stale rain may not settle a new viewport");
  assert.equal(gate.ready(), false);
  assert.equal(gate.loaded(0, second), true);
  assert.equal(gate.ready(), true, "unchanged old layers need no new tile reads");
  gate.loading(2);
  assert.equal(gate.ready(), false);
  gate.loaded(2, second);
  assert.equal(gate.ready(), true);
});

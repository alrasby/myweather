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

test("moveend adopts all unfinished cloud, rain and snow loads from the previous viewport", () => {
  const gate = new SpatialRenderGeneration();
  const first = gate.begin();
  gate.loading(0); gate.loading(1); gate.loading(2);
  gate.loaded(0, first);
  gate.loaded(1, first);
  assert.equal(gate.pending, 1);
  const moved = gate.begin([2]);
  assert.notEqual(moved, first);
  assert.equal(gate.pending, 1);
  assert.equal(gate.loaded(2, first), false, "stale event token cannot prematurely settle the new generation");
  assert.equal(gate.loaded(2, moved), true, "the original Leaflet queue is adopted after a pan");
  assert.equal(gate.ready(), true, "snow's completion must not leave the whole ECMWF frame invisible");
});

test("repeated pan and zoom while a tile layer decodes rebase its pending token without losing completion", () => {
  const gate = new SpatialRenderGeneration();
  gate.begin();
  gate.loading(0);
  gate.loading(1);
  const second = gate.begin([0, 1]);
  gate.loaded(0, second);
  const third = gate.begin([1]);
  assert.equal(gate.loaded(1, third), true);
  assert.equal(gate.ready(), true);
});

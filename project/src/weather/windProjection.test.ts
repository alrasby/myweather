import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestWorldLongitude } from "./windProjection.ts";

test("wind trails follow the nearest Leaflet world during east/west pan", () => {
  assert.equal(nearestWorldLongitude(-179, 179), 181);
  assert.equal(nearestWorldLongitude(179, -179), -181);
  assert.equal(nearestWorldLongitude(-175, 540), 545);
  assert.equal(nearestWorldLongitude(32, 30), 32);
});
test("non-finite projected longitude is not promoted to a bogus zero coordinate", () => {
  assert.ok(Number.isNaN(nearestWorldLongitude(NaN, 30)));
});

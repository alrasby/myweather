import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestWorldLongitude, windScreenStepDegrees } from "./windProjection.ts";

test("wind trails follow the nearest Leaflet world during east/west pan", () => {
  assert.equal(nearestWorldLongitude(-179, 179), 181);
  assert.equal(nearestWorldLongitude(179, -179), -181);
  assert.equal(nearestWorldLongitude(-175, 540), 545);
  assert.equal(nearestWorldLongitude(32, 30), 32);
});
test("non-finite projected longitude is not promoted to a bogus zero coordinate", () => {
  assert.ok(Number.isNaN(nearestWorldLongitude(NaN, 30)));
});

test("Mercator north/south wind speed is normalized across latitudes", () => {
  const equator = windScreenStepDegrees(0, 6, 25, 0.016);
  const north = windScreenStepDegrees(60, 6, 25, 0.016);
  assert.ok(Math.abs(equator.longitude - north.longitude) < 1e-10);
  const normalizedNorth = north.latitude / Math.cos(Math.PI / 3);
  assert.ok(Math.abs(equator.latitude - normalizedNorth) < 1e-10);
});
test("polar projection keeps wind increments finite and bounded", () => {
  const delta = windScreenStepDegrees(84, 8, 30, 0.016);
  assert.ok(Number.isFinite(delta.latitude) && Number.isFinite(delta.longitude));
  assert.ok(delta.latitude > 0 && delta.latitude <= delta.longitude);
});

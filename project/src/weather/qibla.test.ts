import test from "node:test";
import assert from "node:assert/strict";
import { qiblaBearing, relativeQiblaDirection } from "./qibla.ts";

test("great-circle bearings for Muscat, New York and London", () => {
  assert.ok(Math.abs(qiblaBearing(23.588, 58.3829)! - 266.3) < 1);
  assert.ok(Math.abs(qiblaBearing(40.7128, -74.006)! - 58.5) < 0.5);
  assert.ok(Math.abs(qiblaBearing(51.5074, -0.1278)! - 119) < 1);
});
test("invalid or geographically undefined bearing is not fabricated", () => {
  assert.equal(qiblaBearing(NaN, 55), null);
  assert.equal(qiblaBearing(91, 55), null);
  assert.equal(qiblaBearing(21.4224779, 39.8251832), null);
});
test("relative direction rotates with device heading, wrapping across north", () => {
  assert.equal(relativeQiblaDirection(5, 355), 10);
  assert.equal(relativeQiblaDirection(260, 280), 340);
});

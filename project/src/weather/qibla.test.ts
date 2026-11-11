import assert from "node:assert/strict";
import { test } from "node:test";
import { qiblaBearing, relativeQiblaAngle, normalizeBearing } from "./qibla.ts";

test("Muscat bearing is toward the west-southwest (great circle)", () => {
  const d = qiblaBearing(23.588, 58.3829)!;
  assert.ok(d > 260 && d < 275, String(d));
});
test("Kuala Lumpur bearing is northwest and New York northeast", () => {
  const kl = qiblaBearing(3.139, 101.6869)!;
  const ny = qiblaBearing(40.7128, -74.006)!;
  assert.ok(kl > 285 && kl < 310, String(kl));
  assert.ok(ny > 50 && ny < 70, String(ny));
});
test("device heading rotates the qibla pointer without changing true geographic bearing", () => {
  assert.equal(relativeQiblaAngle(270, 90), 180);
  assert.equal(relativeQiblaAngle(270, 300), 330);
  assert.equal(normalizeBearing(-90), 270);
});
test("bad coordinates and Kaaba location do not create a fictitious bearing", () => {
  assert.equal(qiblaBearing(100, 58), null);
  assert.equal(qiblaBearing(NaN, 58), null);
  assert.equal(qiblaBearing(21.422487, 39.826206), null);
});

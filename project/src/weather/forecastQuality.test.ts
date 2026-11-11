import assert from "node:assert/strict";
import { test } from "node:test";
import { metRainRate, isRecentObservation, validDailyTemperatures } from "./forecastQuality.ts";
test("MET.no 1-hour precipitation wins over overlapping six and twelve-hour buckets", () => {
  assert.equal(metRainRate(0.6, 12, 24), 0.6);
  assert.equal(metRainRate(0, 9, 18), 0);
});
test("MET.no six-hour and twelve-hour period accumulations are hourly normalized", () => {
  assert.equal(metRainRate(undefined, 12, 36), 2);
  assert.equal(metRainRate(null, null, 24), 2);
  assert.equal(metRainRate(null, null, null), 0);
  assert.equal(metRainRate(-4, 6, null), 1);
});
test("Reject stale or impossible current data, permit provider timestamp lag", () => {
  const now = Date.parse("2026-11-11T15:10:00Z");
  assert.equal(isRecentObservation(now - 30 * 60_000, now), true);
  assert.equal(isRecentObservation(now - 9 * 3_600_000, now), false);
  assert.equal(isRecentObservation(now + 4 * 3_600_000, now), false);
  assert.equal(isRecentObservation(Number.NaN, now), false);
});
test("daily temperature range must be realistic and not reversed", () => {
  assert.equal(validDailyTemperatures(35, 24), true);
  assert.equal(validDailyTemperatures(12, 19), false);
  assert.equal(validDailyTemperatures(Number.NaN, 10), false);
});

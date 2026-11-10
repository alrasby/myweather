import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPlaybackHour, secondsPerForecastHour, weatherLoadingPhase } from "./weatherPlayback.ts";

test("rain/snow playback does not outrun ECMWF; wind and temperature retain their cadence", () => {
  assert.equal(secondsPerForecastHour(2), 4);
  assert.equal(secondsPerForecastHour(0), 1.7);
  assert.equal(secondsPerForecastHour(1), 1.7);
  assert.equal(nextPlaybackHour(2, 0.05, 47, 4, () => true).hour, 2.0125);
});

test("an unavailable forecast holds its displayed time and reports waiting", () => {
  const step = nextPlaybackHour(6, 0.05, 47, 4, () => false);
  assert.deepEqual(step, { hour: 6, waiting: true });
  assert.deepEqual(nextPlaybackHour(6, 0.05, 47, 4, () => true), { hour: 6.0125, waiting: false });
});

test("playback wraps only when a new ready frame permits it", () => {
  assert.deepEqual(nextPlaybackHour(46.99, 0.05, 47, 4, () => false), { hour: 46.99, waiting: true });
  assert.deepEqual(nextPlaybackHour(46.99, 0.05, 47, 4, () => true), { hour: 0, waiting: false });
});

test("loading indicator ignores short tile refreshes and explains long delays", () => {
  assert.equal(weatherLoadingPhase(200), 0);
  assert.equal(weatherLoadingPhase(649), 0);
  assert.equal(weatherLoadingPhase(650), 1);
  assert.equal(weatherLoadingPhase(7999), 1);
  assert.equal(weatherLoadingPhase(8000), 2);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPlaybackHour, secondsPerForecastHour, weatherLoadingPhase, shouldPaintWeatherFallback, shouldEmitRainFrame, needsRainOverlay, shouldUpdateRainOverlay, shouldUpdateRainFallback, rainClockWithoutGrid } from "./weatherPlayback.ts";

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
  assert.equal(weatherLoadingPhase(1799), 0);
  assert.equal(weatherLoadingPhase(1800), 1);
  assert.equal(weatherLoadingPhase(7999), 1);
  assert.equal(weatherLoadingPhase(8000), 2);
});

test("only covered rain/snow skips redundant fallback RAF paints", () => {
  assert.equal(shouldPaintWeatherFallback(2, true), false);
  assert.equal(shouldPaintWeatherFallback(2, false), true);
  assert.equal(shouldPaintWeatherFallback(0, true), true);
  assert.equal(shouldPaintWeatherFallback(1, true), true);
});

test("rain frame sampling uses 20Hz while keeping initial frame and other layers unchanged", () => {
  assert.equal(shouldEmitRainFrame(100, 0), true);
  assert.equal(shouldEmitRainFrame(149, 100), false);
  assert.equal(shouldEmitRainFrame(150, 100), true);
  assert.equal(shouldEmitRainFrame(180, 150), false);
  assert.equal(shouldEmitRainFrame(200, 150), true);
});

test("no cyclone markers means the rain particle canvas never needs a continuous repaint", () => {
  assert.equal(needsRainOverlay(false, 4), false);
  assert.equal(needsRainOverlay(true, 0), false);
  assert.equal(needsRainOverlay(true, 2), true);
});
test("enabled cyclone markers are throttled without delaying first paint", () => {
  assert.equal(shouldUpdateRainOverlay(10, 0), true);
  assert.equal(shouldUpdateRainOverlay(109, 100), false);
  assert.equal(shouldUpdateRainOverlay(179, 100), false);
  assert.equal(shouldUpdateRainOverlay(180, 100), true);
});

test("low-resolution fallback limits GPU redraws while ECMWF decodes", () => {
  assert.equal(shouldUpdateRainFallback(20, 0), true);
  assert.equal(shouldUpdateRainFallback(199, 100), false);
  assert.equal(shouldUpdateRainFallback(200, 100), true);
});

test("rain clock remains based on one real UTC hour while spatial/actual grids load", () => {
  const now = Date.parse("2026-11-12T06:55:00Z");
  assert.equal(rainClockWithoutGrid(now, 0), Date.parse("2026-11-12T06:00:00Z"));
  assert.equal(rainClockWithoutGrid(now, 1.25), Date.parse("2026-11-12T07:15:00Z"));
  assert.equal(rainClockWithoutGrid(now, NaN), Date.parse("2026-11-12T06:00:00Z"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { marineTideForecast, parseMarineResponse } from "./marineTides.ts";

test("Muscat is coastal when marine sea grid is nearby", () => {
  const m = parseMarineResponse({
    latitude: 23.61, longitude: 58.40, current: { wave_height: 0.5 },
    hourly: { time: [100, 3700, 7300], sea_level_height_msl: [0, 1, 0] },
  }, { lat: 23.588, lon: 58.383 });
  assert.equal(m.coastal, true);
  assert.equal(m.wave, 0.5);
  assert.equal(m.tides?.length, 3);
});
test("an inland city cannot claim coastline based on very distant sea cell", () => {
  const m = parseMarineResponse({ latitude: 25, longitude: 58, current: { wave_height: 2 } },
    { lat: 23.588, lon: 58.383 });
  assert.equal(m.coastal, false);
});
test("tides are derived from modelled sea levels, not fabricated cycles", () => {
  const samples = [0, 1, 0, -1, 0, 1, 0].map((level, i) => ({ t: i * 3600000, level }));
  const tide = marineTideForecast(samples, 0);
  assert.equal(tide.nextHigh?.t, 3600000);
  assert.equal(tide.nextLow?.t, 3 * 3600000);
  assert.equal(tide.events.length, 3);
});
test("missing marine data never produces synthetic tide heights", () => {
  const tide = marineTideForecast([], Date.now());
  assert.equal(tide.nextHigh, null);
  assert.equal(tide.points.length, 0);
});

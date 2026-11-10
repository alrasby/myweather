import assert from "node:assert/strict";
import { test } from "node:test";
import { solarDaylight, daylightNow } from "./astro.ts";
import { repairSolarForecast, solarEventsForDate } from "./solarForecast.ts";
import type { WeatherBundle } from "./types.ts";

const date = "2026-11-10";
const at = (hour: number) => Date.parse(`2026-11-10T${String(hour).padStart(2, "0")}:00:00Z`);
const format = (ms: number, zone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(ms));

test("Muscat local sunrise and sunset are around 06:30 and 17:30, not offset twice", () => {
  const sun = solarEventsForDate(date, 23.588, 58.3829);
  assert.match(format(sun.rise, "Asia/Muscat"), /^0[56]:/);
  assert.match(format(sun.set, "Asia/Muscat"), /^17:/);
  assert.equal(solarDaylight(23.588, 58.3829, at(12)), true);
});

test("New York sunrise and sunset do not shift by the local UTC offset twice", () => {
  const sun = solarEventsForDate(date, 40.7128, -74.006);
  assert.match(format(sun.rise, "America/New_York"), /^0[67]:/);
  assert.match(format(sun.set, "America/New_York"), /^1[67]:/);
});

test("a cached MET.no sunrise/sunset with double timezone correction is repaired", () => {
  const actual = solarEventsForDate(date, 23.588, 58.3829);
  const old = {
    timezone: "Asia/Muscat",
    daily: [{ t: at(8), sunrise: actual.rise - 4 * 3_600_000, sunset: actual.set - 4 * 3_600_000 }],
  } as WeatherBundle;
  const fixed = repairSolarForecast(old, { lat: 23.588, lon: 58.3829 });
  assert.equal(fixed.daily[0]?.sunrise, actual.rise);
  assert.equal(fixed.daily[0]?.sunset, actual.set);
  assert.equal(daylightNow(at(12), 23.588, 58.3829, fixed.daily), true);
  assert.equal(daylightNow(at(17), 23.588, 58.3829, fixed.daily), false);
});

test("valid provider events stay untouched rather than being replaced by estimates", () => {
  const sun = solarEventsForDate(date, 23.588, 58.3829);
  const source = {
    timezone: "Asia/Muscat",
    daily: [{ t: at(8), sunrise: sun.rise + 6 * 60_000, sunset: sun.set - 5 * 60_000 }],
  } as WeatherBundle;
  assert.equal(repairSolarForecast(source, { lat: 23.588, lon: 58.3829 }), source);
});

test("invalid date keys cannot silently create bogus solar data", () => {
  assert.equal(Number.isNaN(solarEventsForDate("tomorrow", 23, 58).rise), true);
});

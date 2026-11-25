import test from "node:test";
import assert from "node:assert/strict";
import { shadowPath } from "./moonDisc.ts";
import { moonRiseSet, moonState, lunarHorizonPass } from "./astro.ts";

function shadowArea(phase: number): number {
  const points = [...shadowPath(phase).matchAll(/([\d.-]+) ([\d.-]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    twice += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return Math.abs(twice) / 2 / (Math.PI * 2500);
}
test("painted lunar illumination follows the complete cycle, including waning gibbous regression", () => {
  for (let n = 0; n <= 100; n++) {
    const phase = n / 100;
    const expectedDark = (1 + Math.cos(phase * 2 * Math.PI)) / 2;
    assert.ok(Math.abs(shadowArea(phase) - expectedDark) < 0.002, String(phase));
  }
  assert.ok(shadowArea(0.53) < 0.01, "post-full Moon must not become a dark disc");
  assert.ok(shadowArea(0.97) > 0.99, "waning crescent must not become full");
});
test("Muscat video date has a bright gibbous Moon and local-day rise/set in the correct order", () => {
  const now = Date.parse("2026-11-25T14:44:00Z");
  const moon = moonState(now);
  assert.ok(moon.frac > 0.5 && moon.frac < 0.56);
  assert.ok(moon.illum > 0.97);
  const events = moonRiseSet(23.59, 58.38, now, "Asia/Muscat");
  // Independent published Muscat calendar: 17:52 rise, 07:06 set (UTC+4).
  // Ten-minute tolerance is explicit for this lightweight approximate ephemeris.
  assert.ok(Math.abs(events.rise! - Date.parse("2026-11-25T13:52:00Z")) < 600_000);
  assert.ok(Math.abs(events.set! - Date.parse("2026-11-25T03:06:00Z")) < 600_000);
  assert.ok(events.set! < events.rise!, "morning set belongs to previous night's passage");
  const pass = lunarHorizonPass(23.59,58.38,now)!;
  assert.ok(pass.rise! < now && pass.set! > now);
  assert.ok(Math.abs(pass.rise! - events.rise!) < 1000);
});
test("invalid dates never throw in lunar event or illumination functions", () => {
  assert.deepEqual(moonRiseSet(23,58,1e99), {rise:null,set:null});
  assert.equal(moonState(NaN).illum,0);
});


// Fixed independent Swiss Ephemeris 2.10.03/Moshier outputs, generated with
// rise_trans (standard upper-limb rise/set, sea level, pressure auto, 15C).
// UTC calendar dates; phase illumination sampled at 12:00 UTC.
// No ephemeris package or network is used by the app or these tests.
test("four global cities and four phases agree with independent ephemeris fixtures", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixtures = JSON.parse(await readFile(new URL("./lunarReference.json", import.meta.url), "utf8"));
  for (const f of fixtures) {
    const now = Date.parse(f.date + "T12:00:00Z");
    const actual = moonRiseSet(f.lat, f.lon, now, "UTC");
    for (const k of ["rise", "set"] as const) {
      if (f[k] === null) assert.equal(actual[k], null, f.city + " no event on UTC date");
      else assert.ok(actual[k] !== null && Math.abs(actual[k]! - f[k]) < 120_000, f.city + " " + f.date + " " + k);
    }
    assert.ok(Math.abs(moonState(now).illum - f.illum) < 0.002, f.date + " illuminated fraction");
  }
});

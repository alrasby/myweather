import test from "node:test";
import assert from "node:assert/strict";
import { celestialMotion, orbitPoint } from "./celestialMotion.ts";
import { lunarHorizonPass, moonAboveHorizon } from "./astro.ts";

const rise = Date.parse("2026-11-24T02:26:00Z"), set = Date.parse("2026-11-24T13:20:00Z");
const days = [{ sunrise: rise, sunset: set }];
test("source sunrise, solar midpoint and sunset map from right to left without extending past source sunset", () => {
  assert.equal(celestialMotion(23.59, 58.38, rise - 1, days).sun, null);
  assert.equal(celestialMotion(23.59, 58.38, rise, days).sun?.progress, 0);
  assert.equal(celestialMotion(23.59, 58.38, (rise + set) / 2, days).sun?.progress, 0.5);
  assert.ok(celestialMotion(23.59, 58.38, set - 1, days).sun!.progress > 0.999);
  assert.equal(celestialMotion(23.59, 58.38, set, days).sun, null);
  assert.deepEqual(orbitPoint(0), { x: 1, arch: 0 });
  assert.deepEqual(orbitPoint(0.5), { x: 0.5, arch: 1 });
  assert.deepEqual(orbitPoint(1), { x: 0, arch: 0 });
});
test("changing city immediately changes astronomical visibility; invalid coordinates never fabricate bodies", () => {
  const now = Date.parse("2026-11-24T08:00:00Z");
  assert.ok(celestialMotion(23.59, 58.38, now).sun);
  assert.equal(celestialMotion(40.71, -74.01, now).sun, null);
  for (const [lat, lon, time] of [[NaN, 0, now], [91, 0, now], [0, 181, now], [0, 0, NaN], [0, 0, 1e99]]) {
    const sky = celestialMotion(lat, lon, time);
    assert.equal(sky.sun, null);assert.equal(sky.moon, null);
  }
});
test("lunar passages cross midnight and advance independently of solar day; bounded cache does not shift events", () => {
  let crossings = 0, daylightMoons = 0;
  const start = Date.parse("2026-11-01T00:00:00Z");
  for (let i = 0; i < 30 * 8; i++) {
    const now = start + i * 3 * 3_600_000;
    const sky = celestialMotion(23.59, 58.38, now);
    if (sky.moon) {
      assert.ok(moonAboveHorizon(23.59, 58.38, now));
      assert.ok(sky.moon.progress >= 0 && sky.moon.progress <= 1);
      if (sky.sun) daylightMoons++;
      if (sky.moon.rise !== null && sky.moon.set !== null && new Date(sky.moon.rise).getUTCDate() !== new Date(sky.moon.set).getUTCDate()) crossings++;
      const again = lunarHorizonPass(23.59, 58.38, now);
      assert.equal(again?.rise, sky.moon.rise);assert.equal(again?.set, sky.moon.set);
    }
  }
  assert.ok(crossings > 0);assert.ok(daylightMoons > 0);
});
test("phases and hemispheres vary while continuous polar daylight never invents sunrise or sunset", () => {
  const a = celestialMotion(23.59, 58.38, Date.parse("2026-11-10T08:00:00Z"));
  const b = celestialMotion(-33.9, 18.4, Date.parse("2026-11-24T08:00:00Z"));
  assert.notEqual(a.phase, b.phase);assert.equal(a.moonRotation, 0);assert.equal(b.moonRotation, 180);
  assert.ok(a.illumination >= 0 && b.illumination <= 1);
  const polar = celestialMotion(80, 20, Date.parse("2026-06-21T12:00:00Z"));
  assert.ok(polar.sun?.continuous);assert.equal(polar.sun.rise, null);assert.equal(polar.sun.set, null);
  assert.equal(celestialMotion(80, 20, Date.parse("2026-12-21T12:00:00Z")).sun, null);
});


test("lunar events remain stable across hourly cache boundaries and new moon is not a full daylight disc", () => {
  let checked = false;
  const start = Date.parse("2026-11-24T00:00:00Z");
  for (let i = 1; i < 24; i++) {
    const t = start + i * 3_600_000;
    const before = lunarHorizonPass(23.59, 58.38, t - 1000);
    const after = lunarHorizonPass(23.59, 58.38, t + 1000);
    if (before && after && before.rise !== null && after.rise !== null) {
      assert.ok(Math.abs(before.rise - after.rise) < 10);
      assert.ok(Math.abs(before.set! - after.set!) < 10);
      checked = true; break;
    }
  }
  assert.ok(checked);
  assert.equal(celestialMotion(23.59, 58.38, Date.UTC(2000, 0, 6, 18, 14)).moon, null);
});

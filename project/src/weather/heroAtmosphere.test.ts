import assert from "node:assert/strict";
import { test } from "node:test";
import { heroAtmosphere } from "./heroAtmosphere.ts";

test("clear skies avoid cloud wash, partly cloudy adapts to actual density", () => {
  const clear = heroAtmosphere(0, 4, 9);
  const thin = heroAtmosphere(2, 28, 9);
  const thick = heroAtmosphere(3, 87, 9);
  assert.equal(clear.clouds, 0);
  assert.ok(thin.coverage > clear.coverage);
  assert.ok(thick.clouds > thin.clouds);
  assert.ok(thick.opacity > thin.opacity);
});

test("real weather condition drives rain, snowfall and storm cloud shading", () => {
  assert.equal(heroAtmosphere(61, 65, 8).precipitation, "rain");
  assert.equal(heroAtmosphere(73, 80, 8).precipitation, "snow");
  assert.equal(heroAtmosphere(95, 80, 8).dark, true);
  assert.equal(heroAtmosphere(3, 95, 8).precipitation, "none");
});

test("wind drift and alpha remain bounded for invalid/extreme model values", () => {
  const calm = heroAtmosphere(3, 80, 1);
  const strong = heroAtmosphere(3, 80, 60);
  assert.ok(strong.driftPxPerSecond > calm.driftPxPerSecond);
  assert.ok(heroAtmosphere(3, Infinity, Infinity).opacity <= 0.86);
  assert.ok(heroAtmosphere(3, -200, -70).driftPxPerSecond >= 1.2);
});


test("a clear provider symbol cannot suppress valid scattered or dense cloud evidence", () => {
  assert.ok(heroAtmosphere(0, 24, 5).clouds >= 1);
  assert.ok(heroAtmosphere(0, 65, 5).coverage >= 0.65);
  assert.ok(heroAtmosphere(0, 95, 5).coverage >= 0.95);
  assert.equal(heroAtmosphere(0, 95, 5).precipitation, "none");
  assert.equal(heroAtmosphere(0, 2, 5).clouds, 0);
});

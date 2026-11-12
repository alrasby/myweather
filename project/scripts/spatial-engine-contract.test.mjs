import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("ECMWF range deduplication and provider 429 cooldown happen inside the existing native path", () => {
  const model = read("project/src/weather/modelField.ts");
  assert.ok(model.includes('const spatialLengthFlights = new SpatialRangeFlights<string | null>()'));
  assert.ok(model.includes('spatialLengthFlights.run(`length|${url}`'));
  assert.ok(model.includes("spatialRateLimit.assertAllowed()"));
  assert.ok(model.includes("spatialRateLimit.observe(result.status"));
  assert.ok(model.includes("if (error instanceof SpatialRateLimitError || spatialRateLimit.remainingMs() > 0)"));
  assert.ok(model.includes("rateLimitRemainingMs: spatialRateLimit.remainingMs()"));
  assert.ok(model.includes("this.firstCloudReadyMs = performance.now() - this.attachedAt"));
  assert.ok(model.includes("this.firstCompleteReadyMs = performance.now() - this.attachedAt"));
});

test("rain never samples estimated bootstrap grids as real rainfall", () => {
  const field = read("project/src/weather/glField.ts");
  const pick = field.split("private pick(): GridField | null {")[1]?.split("  /**")[0];
  assert.ok(pick, "rain selection must exist");
  assert.ok(pick.includes('!this.detail.id.startsWith("est|")'));
  assert.ok(pick.includes("return null;"), "no synthetic fallback for absent rain data");
  assert.ok(field.includes("if (this.kind === 2 && grid.id.startsWith(\"est|\")) continue;"));
});

test("MapTiler experiment never replaces ECMWF map rendering nor stores a key", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  const pilot = read("project/src/weather/maptilerPilot.ts");
  assert.ok(map.includes("inspectMapTilerCatalog(key, ctrl.signal)"));
  assert.ok(map.includes('setPilotKey("");'));
  assert.ok(pilot.includes('"/weather/latest.json"') || pilot.includes('"https://api.maptiler.com/weather/latest.json"'));
  assert.ok(!pilot.includes("localStorage") && !pilot.includes("sessionStorage"));
  assert.ok(!pilot.includes("createTileLayer") && !pilot.includes("WeatherLayer("));
  assert.ok(map.includes('new ModelField()'), "the standard ECMWF engine remains primary");
});

test("performance details stay inside existing hidden diagnostics and preserve map sources", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(map.includes("weatherDiagnosticsOpen"));
  assert.ok(map.includes("Copy actual performance report"));
  assert.ok(map.includes("startupMs.firstCompleteReady"));
  assert.ok(map.includes("rateLimitedResponses"));
  assert.ok(map.includes("engine.canAdvanceRainTime"));
});

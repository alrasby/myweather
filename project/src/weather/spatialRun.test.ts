import assert from "node:assert/strict";
import { test } from "node:test";
import { pinSpatialRun, pinnedSpatialTileUrl } from "./spatialRun.ts";

const meta = {
  reference_time: "2026-11-11T00:00:00Z",
  valid_times: [
    "2026-11-11T00:00Z",
    "2026-11-11T01:00Z",
    "2026-11-11T02:00Z",
    "2026-11-11T05:00Z",
  ],
  completed: true,
};

test("pin ECMWF cloud/rain/snow to the same immutable 00Z model run", () => {
  const run = pinSpatialRun(meta);
  assert.ok(run);
  for (const variable of ["cloud_cover", "precipitation", "snowfall_water_equivalent"]) {
    const result = pinnedSpatialTileUrl(run, variable, 2);
    assert.match(result, /^om:\/\/https:\/\/openmeteo\.s3\.amazonaws\.com\/data_spatial\/ecmwf_ifs\/2026\/11\/11\/0000Z\/2026-11-11T0200\.om\?/);
    assert.equal(new URL(result.slice(5)).searchParams.get("variable"), variable);
    assert.equal(new URL(result.slice(5)).searchParams.get("delta_time_hours"), "1");
    assert.equal(result.includes("latest.json"), false);
    assert.equal(result.includes("time_step="), false);
  }
});

test("hourly and multi-hour precipitation accumulation use correct step duration", () => {
  const run = pinSpatialRun(meta)!;
  const at0 = new URL(pinnedSpatialTileUrl(run, "precipitation", 0).slice(5));
  const at1 = new URL(pinnedSpatialTileUrl(run, "precipitation", 1).slice(5));
  const at3 = new URL(pinnedSpatialTileUrl(run, "snowfall_water_equivalent", 3).slice(5));
  assert.equal(at0.searchParams.get("delta_time_hours"), "1");
  assert.equal(at1.searchParams.get("delta_time_hours"), "1");
  assert.equal(at3.searchParams.get("delta_time_hours"), "3");
  assert.match(at3.pathname, /2026-11-11T0500\.om$/);
});

test("a new latest.json run does not mutate already-pinned forecast URLs", () => {
  const oldRun = pinSpatialRun(meta)!;
  const oldUrl = pinnedSpatialTileUrl(oldRun, "cloud_cover", 1);
  meta.reference_time = "2026-11-11T06:00:00Z";
  meta.valid_times = ["2026-11-11T06:00Z", "2026-11-11T07:00Z", "2026-11-11T08:00Z", "2026-11-11T11:00Z"];
  assert.equal(pinnedSpatialTileUrl(oldRun, "cloud_cover", 1), oldUrl);
  assert.match(pinnedSpatialTileUrl(pinSpatialRun(meta)!, "cloud_cover", 1), /0600Z\/2026-11-11T0700\.om/);
});

test("invalid model metadata never generates a synthetic file path", () => {
  assert.equal(pinSpatialRun({ reference_time: "bad", valid_times: ["2026-11-11T01:00Z"] }), null);
  assert.equal(pinSpatialRun({ reference_time: "2026-11-11T00:00Z", valid_times: ["bad"] }), null);
  assert.equal(pinSpatialRun({ reference_time: "2026-11-11T00:00Z", valid_times: ["2026-11-11T02:00Z", "2026-11-11T01:00Z"] }), null);
  assert.throws(() => pinnedSpatialTileUrl(pinSpatialRun(meta)!, "cloud_cover", 99), /invalid ECMWF/);
});

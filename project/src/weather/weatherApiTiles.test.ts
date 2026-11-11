import test from "node:test";
import assert from "node:assert/strict";
import { weatherApiStamp, weatherApiTileUrl, weatherApiForecastTime } from "./weatherApiTiles.ts";

test("UTC timestamp includes exact date and padded hour", () => {
  assert.equal(weatherApiStamp(Date.parse("2026-11-11T05:59:00Z")), "2026111105");
  assert.equal(weatherApiStamp(Date.parse("2026-12-31T23:00:00Z")), "2026123123");
});
test("public no-key weatherapi URLs are restricted to known map layers", () => {
  assert.equal(weatherApiTileUrl("precip", Date.parse("2026-11-11T05:10:00Z")),
    "https://weathermaps.weatherapi.com/precip/tiles/2026111105/{z}/{x}/{y}.png");
  assert.throws(() => weatherApiTileUrl("cloud" as never, Date.now()));
});
test("timestamps never exceed 72 hour published horizon", () => {
  const now = Date.parse("2026-11-11T08:25:00Z");
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-11T08:01:00Z"), now),
    Date.parse("2026-11-11T08:00:00Z"));
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-14T08:00:00Z"), now), null);
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-11T07:00:00Z"), now), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { suppressCityOnRefresh, visibleWeatherNotices } from "./alertVisibility.ts";

test("pull refresh hides all city banners, including newly fetched same-city alerts", () => {
  const hidden = suppressCityOnRefresh([], "muscat");
  assert.deepEqual(visibleWeatherNotices(["Rain expected"], hidden, "muscat", []), []);
  assert.deepEqual(visibleWeatherNotices(["High wind"], hidden, "muscat", []), []);
});
test("refreshing one city never suppresses another city's weather alerts", () => {
  const hidden = suppressCityOnRefresh([], "muscat");
  assert.deepEqual(visibleWeatherNotices(["Rain expected"], hidden, "london", []), ["Rain expected"]);
});
test("tap-X manual dismiss still works without a swipe", () => {
  assert.deepEqual(visibleWeatherNotices(["Rain expected", "Wind"], [], "muscat",
    ["muscat|Rain expected"]), ["Wind"]);
});
test("repeat pulls preserve a deduplicated bounded city list", () => {
  const once = suppressCityOnRefresh(["muscat"], "muscat");
  assert.deepEqual(once, ["muscat"]);
  let hidden: string[] = [];
  for (let i = 0; i < 45; i++) hidden = suppressCityOnRefresh(hidden, String(i));
  assert.equal(hidden.length, 32);
  assert.ok(!hidden.includes("0"));
  assert.ok(hidden.includes("44"));
});

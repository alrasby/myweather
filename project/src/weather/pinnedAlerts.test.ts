import assert from "node:assert/strict";
import { test } from "node:test";
import { pinWeatherAlerts } from "./pinnedAlerts.ts";
test("pull-to-refresh cannot remove an alert before user closes it", () => {
  const shown = pinWeatherAlerts([], ["مطر متوقع"]);
  assert.deepEqual(pinWeatherAlerts(shown, []), ["مطر متوقع"]);
});
test("new warnings are added without duplicates while old ones remain", () => {
  assert.deepEqual(pinWeatherAlerts(["مطر متوقع"], ["مطر متوقع", "رياح قوية"]),
    ["مطر متوقع", "رياح قوية"]);
});

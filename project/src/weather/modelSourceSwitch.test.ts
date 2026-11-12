import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseWeatherSource } from "./modelSourceSwitch.ts";

test("real fallback activates atomically only for a missing ECMWF hour", () => {
  assert.deepEqual(chooseWeatherSource(false, true, false), { fallback: true, snapCompleteModel: false });
  assert.deepEqual(chooseWeatherSource(false, false, false), { fallback: false, snapCompleteModel: false });
  assert.deepEqual(chooseWeatherSource(true, true, false), { fallback: false, snapCompleteModel: false });
});
test("fully loaded new model returns in one step without mixed fallback opacity", () => {
  assert.deepEqual(chooseWeatherSource(true, true, true), { fallback: false, snapCompleteModel: true });
  assert.deepEqual(chooseWeatherSource(true, false, true), { fallback: false, snapCompleteModel: true });
  assert.deepEqual(chooseWeatherSource(false, true, true), { fallback: true, snapCompleteModel: false });
});

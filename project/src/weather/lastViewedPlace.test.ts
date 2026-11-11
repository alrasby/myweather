import assert from "node:assert/strict";
import { test } from "node:test";
import { LAST_VIEWED_KEY, readLastViewed, restoreViewedPlace, saveLastViewed } from "./lastViewedPlace.ts";
import { INITIAL_CITIES } from "./defaultCities.ts";

const custom = {
  id: "23.615,58.196", name: "ولاية السيب ـ موقع مخصص",
  country: "عُمان", admin: "مسقط", lat: 23.615, lon: 58.196,
  primary: false,
};

test("unsaved manually selected GPS preview survives restart without adding saved city", () => {
  const result = restoreViewedPlace(custom, INITIAL_CITIES, INITIAL_CITIES[0]!.id);
  assert.equal(result.activeId, custom.id);
  assert.equal(result.peek?.id, custom.id);
  assert.equal(INITIAL_CITIES.length, 4);
});
test("selected saved city loads as saved, never creates duplicate peek", () => {
  const result = restoreViewedPlace(INITIAL_CITIES[2]!, INITIAL_CITIES, INITIAL_CITIES[0]!.id);
  assert.equal(result.activeId, INITIAL_CITIES[2]!.id);
  assert.equal(result.peek, null);
});
test("missing or invalid last viewed location falls back to primary", () => {
  const result = restoreViewedPlace({ ...custom, lat: NaN }, INITIAL_CITIES, INITIAL_CITIES[0]!.id);
  assert.equal(result.activeId, INITIAL_CITIES[0]!.id);
  assert.equal(result.peek, null);
});
test("storage retains one last view across hydration calls", () => {
  const data = new Map<string, string>();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: k => void data.delete(k),
  } as Storage;
  try {
    saveLastViewed(custom);
    assert.ok(data.has(LAST_VIEWED_KEY));
    assert.equal(readLastViewed()?.name, custom.name);
    saveLastViewed(null);
    assert.equal(readLastViewed(), null);
  } finally {
    if (previous === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else globalThis.localStorage = previous;
  }
});

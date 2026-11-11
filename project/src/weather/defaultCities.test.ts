import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_CITIES, upgradeInitialCities } from "./defaultCities.ts";
import { MUSCAT, type Place } from "./types.ts";
const legacyKhoud: Place = { ...MUSCAT, id: "23.62,58.19", name: "الخوض", nameEn: "Al Khoud", lat: 23.62, lon: 58.19, primary: true };
const legacyPrague: Place = { ...MUSCAT, id: "50.08,14.44", name: "براغ", nameEn: "Prague", lat: 50.075, lon: 14.44, primary: false };
test("first install has four saved cities, Muscat first and primary", () => {
  const result = upgradeInitialCities([], "");
  assert.deepEqual(result.places.map(p => p.nameEn), ["Muscat", "London", "New York", "Beijing"]);
  assert.equal(result.activeId, MUSCAT.id);
  assert.equal(result.places.filter(p => p.primary).length, 1);
  assert.equal(INITIAL_CITIES.length, 4);
});
test("migrates only Al Khoud and Prague, preserves New York and Beijing", () => {
  const result = upgradeInitialCities([legacyKhoud, legacyPrague, INITIAL_CITIES[2]!, INITIAL_CITIES[3]!], legacyKhoud.id);
  assert.deepEqual(result.places.map(p => p.nameEn), ["Muscat", "London", "New York", "Beijing"]);
  assert.equal(result.activeId, MUSCAT.id);
  assert.equal(result.changed, true);
});
test("does not overwrite manually chosen saved cities or later primary", () => {
  const chosen = [{ ...INITIAL_CITIES[2]!, primary: true }, { ...MUSCAT, primary: false }];
  const result = upgradeInitialCities(chosen, chosen[0]!.id);
  assert.equal(result.changed, false);
  assert.equal(result.activeId, chosen[0]!.id);
  assert.deepEqual(result.places, chosen);
});
test("does not duplicate Muscat/London if already saved", () => {
  const result = upgradeInitialCities([INITIAL_CITIES[0]!, legacyKhoud, legacyPrague, INITIAL_CITIES[1]!], legacyKhoud.id);
  assert.equal(result.places.length, 2);
  assert.equal(result.places[0]!.primary, true);
});

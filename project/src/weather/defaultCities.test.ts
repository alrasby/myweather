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
test("never infer a starter upgrade from a partial personalized city list", () => {
  const cities = [INITIAL_CITIES[0]!, legacyKhoud, legacyPrague, INITIAL_CITIES[1]!];
  const result = upgradeInitialCities(cities, legacyKhoud.id);
  assert.equal(result.changed, false);
  assert.deepEqual(result.places, cities);
});
test("a user who selects Prague keeps it and its selected status after reopening", () => {
  const ownPrague = { ...legacyPrague, primary: true };
  const cities = [ownPrague, INITIAL_CITIES[1]!, INITIAL_CITIES[2]!];
  const result = upgradeInitialCities(cities, ownPrague.id);
  assert.equal(result.changed, false);
  assert.equal(result.activeId, ownPrague.id);
  assert.deepEqual(result.places, cities);
});
test("worldwide saved cities and a manually chosen primary remain unchanged", () => {
  const ownTokyo: Place = { ...MUSCAT, id: "35.68,139.76", name: "東京",
    nameEn: "Tokyo", country: "Japan", lat: 35.68, lon: 139.76, primary: true };
  const cities = [ownTokyo, legacyKhoud, legacyPrague, INITIAL_CITIES[2]!, INITIAL_CITIES[3]!];
  const result = upgradeInitialCities(cities, ownTokyo.id);
  assert.equal(result.changed, false);
  assert.equal(result.activeId, ownTokyo.id);
  assert.deepEqual(result.places, cities);
});
test("a real legacy starter upgrade keeps an unrelated user-selected city", () => {
  const ownVancouver: Place = { ...MUSCAT, id: "49.28,-123.12", name: "Vancouver",
    nameEn: "Vancouver", country: "Canada", lat: 49.28, lon: -123.12, primary: false };
  const result = upgradeInitialCities([legacyKhoud, legacyPrague, INITIAL_CITIES[2]!, INITIAL_CITIES[3]!, ownVancouver], ownVancouver.id);
  assert.equal(result.changed, true);
  assert.equal(result.activeId, ownVancouver.id);
  assert.ok(result.places.some(p => p.nameEn === "Vancouver"));
});

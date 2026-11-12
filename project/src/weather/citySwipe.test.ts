import assert from "node:assert/strict";
import { test } from "node:test";
import { citySwipeTarget } from "./citySwipe.ts";
const cities = ["muscat", "london", "hammerfest"];

test("Arabic RTL swipes advance saved cities to the right; English mirrors", () => {
  assert.equal(citySwipeTarget(cities,"london",100,15,true),"hammerfest");
  assert.equal(citySwipeTarget(cities,"london",-100,15,true),"muscat");
  assert.equal(citySwipeTarget(cities,"london",-100,15,false),"hammerfest");
  assert.equal(citySwipeTarget(cities,"london",100,15,false),"muscat");
});
test("vertical pull refresh, diagonal gestures, short movements and edges never navigate", () => {
  assert.equal(citySwipeTarget(cities,"london",15,110,true),null);
  assert.equal(citySwipeTarget(cities,"london",95,90,true),null);
  assert.equal(citySwipeTarget(cities,"london",65,0,true),null);
  assert.equal(citySwipeTarget(cities,"hammerfest",100,0,true),null);
  assert.equal(citySwipeTarget(cities,"muscat",-100,0,true),null);
});
test("swipes never add or silently select an unsaved preview location", () => {
  assert.equal(citySwipeTarget(cities,"not-saved",100,0,true),null);
  assert.equal(citySwipeTarget(["muscat"],"muscat",-100,0,false),null);
  assert.equal(citySwipeTarget(cities,"london",NaN,0,false),null);
});

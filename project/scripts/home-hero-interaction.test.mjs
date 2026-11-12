import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("animated weather cloud field is mounted ONLY inside the existing home hero", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const app = read("project/src/components/weather/WeatherApp.tsx");
  const style = read("project/src/styles.css");
  const hero = home.indexOf('className="temp-under-orb');
  const clouds = home.indexOf("<HeroClouds ");
  const nextCard = home.indexOf('<section className="wx-card mt-4 overflow-hidden py-2">');
  assert.ok(hero >= 0 && hero < clouds && clouds < nextCard,
    "The new cloud component must remain inside the top weather hero only");
  assert.ok(!app.includes("HeroClouds"), "No hero cloud layer across the full screen");
  assert.ok(style.includes(".wx-hero-atmosphere") && style.includes("pointer-events: none;"));
  assert.ok(home.includes("bundle.placeId === place.id"), "Never paint previous city's sky");
});

test("hero weather scene is bounded to low frame rate, pauses outside viewport and supports accessibility", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  for (const phrase of [
    'data-hero-weather="localized"', 'IntersectionObserver', 'document.hidden',
    'prefers-reduced-motion: reduce', 'ResizeObserver', 'window.setTimeout', '65)',
    'heroAtmosphere(code, cover, wind)', 'heroCloudTextures(day, plan.dark)',
    'plan.precipitation', 'observer?.disconnect()',
  ]) assert.ok(sky.includes(phrase), phrase);
});

test("saved-city gestures ignore nested horizontal scrollers and preserve vertical refresh", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  assert.ok(home.includes('citySwipeTarget(places.map((p) => p.id), activeId, dx, dy, lang === "ar")'));
  assert.ok(home.includes(".overflow-x-auto"));
  assert.ok(home.includes("Math.abs(dy) > Math.abs(dx) * 1.2"));
  assert.ok(home.includes("hideAlertsAfterPull();"));
  assert.ok(home.includes("setActive(target)"));
  assert.ok(home.includes("onTouchCancel"));
});

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

test("home cloud atmosphere blends out gradually without a rounded or opaque card-edge shelf", () => {
  const css = read("project/src/styles.css");
  const sky = css.split(".sky-clouds.is-deck {")[1]?.split("}")[0];
  const hero = css.split(".wx-hero-atmosphere {")[1]?.split("}")[0];
  assert.ok(sky && hero, "global cloud deck and localized hero must exist");
  assert.ok(!sky.includes("#000 0 88%"), "no late sudden deck cutoff");
  assert.ok(sky.includes("0.82") && sky.includes("0.45") && sky.includes("0.12"),
    "cloud deck must have intermediate alpha levels before cards");
  assert.ok(hero.includes("border-radius: 0"), "rounded atmospheric corners exposed a rectangular edge");
  assert.ok(hero.includes("inset: -0.55rem -1rem -1.6rem"), "scene should bleed into gap above hourly card");
  assert.ok(hero.includes("0.85") && hero.includes("0.46") && hero.includes("0.13"),
    "hero alpha must fade progressively, not stop at the element boundary");
  assert.ok(hero.includes("transparent 100%"), "scene must reach fully transparent before the next card");
});

test("refresh keeps cached city data visible and ignores superseded responses", () => {
  const store = read("project/src/weather/store.ts");
  assert.ok(store.includes("const generation = ++activeLoadGeneration"), "each request must have its own generation");
  assert.ok(store.includes("generation !== activeLoadGeneration"), "out-of-order results must be ignored");
  assert.ok(store.includes("cached?.bundle ?? estimateBundle(place)"), "cached city forecasts should survive a refresh");
  assert.ok(store.includes("stale: !!get().bundle"), "clearing cache must not blank the currently visible forecast");
});

test("city navigation and settings controls retain UX without redesign", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const settings = read("project/src/components/weather/SettingsScreen.tsx");
  assert.ok(!home.includes("scroller.current.scrollTop = 0"), "city swipes should not reset vertical scroll");
  for (const field of ["rainFrom", "windFrom", "dustFrom"]) {
    assert.ok(settings.includes(`<Field label={t(lang, "${field}")}>\n          <Chips\n            disabled={!prefs.alerts}`),
      `${field} must not be keyboard-activatable when alerts are off`);
  }
  assert.ok(settings.includes('aria-label={title}'), "switches need accessible names");
});

test("global cloud layers fade with home scroll without layout changes or JS animation loops", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const css = read("project/src/styles.css");
  assert.ok(home.includes("onScroll={syncSkyScroll}"));
  assert.ok(home.includes('top / 155'));
  assert.ok(home.includes('t * t * (3 - 2 * t)'));
  assert.ok(home.includes('style.setProperty("--wx-sky-cloud-opacity"'));
  assert.ok(home.includes('style.removeProperty("--wx-sky-cloud-opacity"'));
  assert.ok(css.includes("opacity: var(--wx-sky-cloud-opacity, 1)"));
});

test("visible version stays 1.0.0 while upgrade-safe Android code remains 55", () => {
  const gradle = read("project/android/app/build.gradle");
  const workflow = read(".github/workflows/android-ci.yml");
  assert.ok(gradle.includes('versionCode 55') && gradle.includes('versionName "1.0.0"'));
  assert.ok(workflow.includes("versionCode='55' versionName='1.0.0'"));
});

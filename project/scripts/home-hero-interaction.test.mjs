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

test("both interactive cloud layers fade away before hourly cards scroll beneath them", () => {
  const app = read("project/src/components/weather/WeatherApp.tsx");
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const css = read("project/src/styles.css");
  assert.ok(!app.includes("showClouds={false}"), "restore dynamic weather-driven sky clouds");
  assert.ok(app.includes("<SkyBackdrop"), "preserve responsive sky, sun and moon");
  assert.ok(sky.includes("showClouds ? <CloudField"), "restore original CloudField lifecycle");
  assert.ok(home.includes("<HeroClouds"), "retain localized animated clouds and precipitation");
  assert.ok(home.includes("onScroll={syncCloudsWithScroll}"), "tie both cloud layers to the real Home scroller");
  assert.ok(home.includes("top / 96"), "fully fade the clouds before cards reach the sky band");
  assert.ok(home.includes("t * t * (3 - 2 * t)"), "use smoothstep, avoiding abrupt opacity cuts");
  assert.ok(home.includes('style.removeProperty("--wx-cloud-scroll-opacity")'), "reset cloud visibility on leaving Home");
  assert.match(css, /\\.sky-clouds \\{[^}]*opacity: var\\(--wx-cloud-scroll-opacity, 1\\)/);
  assert.match(css, /\\.wx-hero-atmosphere \\{[^}]*opacity: var\\(--wx-cloud-scroll-opacity, 1\\)/);
});

test("15-day card receives subtle polish without changing its structure or baseline palette", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const css = read("project/src/styles.css");
  assert.ok(home.includes("wx-daily-card") && home.includes("wx-daily-row"));
  assert.ok(home.includes("wx-daily-reveal"));
  assert.ok(css.includes("@keyframes wx-day-reveal") && css.includes("prefers-reduced-motion: reduce"));
  assert.ok(css.includes(".wx-daily-card .wx-daily-row"));
  assert.ok(css.includes("backdrop-filter: blur(22px) saturate(1.45)"));
});

test("visible version stays 1.0.0 while upgrade-safe Android code remains 55", () => {
  const gradle = read("project/android/app/build.gradle");
  const workflow = read(".github/workflows/android-ci.yml");
  assert.ok(gradle.includes('versionCode 55') && gradle.includes('versionName "1.0.0"'));
  assert.ok(workflow.includes("versionCode='55' versionName='1.0.0'"));
});

test("Android Auto weather uses trusted Car App templates and the existing forecast snapshot", () => {
  const gradle = read("project/android/app/build.gradle");
  const manifest = read("project/android/app/src/main/AndroidManifest.xml");
  const service = read("project/android/app/src/main/java/net/nabdhserv/myweather/WeatherCarAppService.java");
  const descriptor = read("project/android/app/src/main/res/xml/automotive_app_desc.xml");
  assert.ok(gradle.includes('androidx.car.app:app:1.7.0'));
  assert.ok(gradle.includes('androidx.car.app:app-projected:1.7.0'));
  assert.ok(manifest.includes('androidx.car.app.category.WEATHER'));
  assert.ok(manifest.includes('android:value="7"'));
  assert.ok(manifest.includes('com.google.android.gms.car.application'));
  assert.ok(descriptor.includes('<uses name="template" />'));
  assert.ok(service.includes('new ListTemplate.Builder()'));
  assert.ok(service.includes('WeatherWidget.readPayload(WeatherWidget.prefs(getCarContext()))'));
  assert.ok(service.includes('hosts_allowlist_sample'));
  assert.ok(service.includes('ApplicationInfo.FLAG_DEBUGGABLE'));
  assert.ok(!service.includes('import java.net.HttpURLConnection') && !service.includes('import android.webkit.WebView'));
});

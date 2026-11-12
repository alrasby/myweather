import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("weather animation is behind the upper cards, not a child of scrolling temperature content", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  const app = read("project/src/components/weather/WeatherApp.tsx");
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const style = read("project/src/styles.css");
  assert.ok(home.includes('className="temp-under-orb'), "keep original temperature layout");
  assert.ok(!home.includes("<HeroClouds"), "remove cloud canvas that was glued to the hero card");
  assert.ok(sky.includes("heroWeather ? <HeroClouds"), "preserve adaptive clouds/rain/snow in independent sky scene");
  assert.ok(app.includes('heroWeather={tab === "home" && !placesOpen && bundle?.placeId === place.id}'));
  assert.ok(style.includes(".wx-hero-atmosphere") && style.includes("pointer-events: none;"));
  assert.ok(style.includes("height: 11.5rem"), "precipitation remains bounded above the cards");
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
  assert.ok(home.includes('citySwipeTarget(swipeIds, activeId, dx, dy, lang === "ar")'));
  assert.ok(home.includes(".overflow-x-auto"));
  assert.ok(home.includes("Math.abs(dy) > Math.abs(dx) * 1.2"));
  assert.ok(home.includes("hideAlertsAfterPull();"));
  assert.ok(home.includes("navigateSwipe(target)"));
  assert.ok(home.includes("onTouchCancel"));
});

test("upper sky fades softly behind cards with no scrolling shelf or full-screen rain", () => {
  const css = read("project/src/styles.css");
  const sky = css.split(".sky-clouds.is-deck {")[1]?.split("}")[0];
  const hero = css.split(".wx-hero-atmosphere {")[1]?.split("}")[0];
  assert.ok(sky && hero, "ambient cloud deck and localized precipitation must exist");
  assert.ok(sky.includes("0.82") && sky.includes("0.45") && sky.includes("0.12"));
  assert.ok(hero.includes("position: absolute") && hero.includes("pointer-events: none"));
  assert.ok(hero.includes("height: 11.5rem"), "weather is restricted to upper hero band");
  assert.ok(!hero.includes("inset: -0.55rem"), "hero is no longer glued to the scrolling temperature card");
  assert.ok(hero.includes("0.73") && hero.includes("0.27") && hero.includes("0.07"));
  assert.ok(hero.includes("transparent 100%"), "feather both ends of the atmosphere");
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
  assert.ok(sky.includes("heroWeather ? <HeroClouds"), "retain adaptive local clouds and precipitation in background");
  assert.ok(!home.includes("<HeroClouds"), "no cloud canvas on the scrolling hero");
  assert.ok(home.includes("onScroll={syncCloudsWithScroll}"), "tie both cloud layers to the real Home scroller");
  assert.ok(home.includes("top / 200"), "fully fade the clouds before cards reach the sky band");
  assert.ok(home.includes("t * t * (3 - 2 * t)"), "use smoothstep, avoiding abrupt opacity cuts");
  assert.ok(home.includes('style.removeProperty("--wx-cloud-scroll-opacity")'), "reset cloud visibility on leaving Home");
  assert.ok(css.split(".sky-clouds {")[1]?.split("}")[0]?.includes("opacity: var(--wx-cloud-scroll-opacity, 1)"));
  assert.ok(css.split(".wx-hero-atmosphere {")[1]?.split("}")[0]?.includes("opacity: var(--wx-cloud-scroll-opacity, 1)"));
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

test("saved city paging works on clickable daily rows, including Android touchcancel", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  assert.ok(home.includes('style={{ touchAction: "pan-y" }}'));
  assert.ok(home.includes('const swipeLast = useRef'));
  assert.ok(home.includes('swipeLast.current = { x: point.clientX, y: point.clientY }'));
  assert.ok(home.includes('onTouchCancel={() => {'));
  assert.ok(home.includes('if (target) navigateSwipe(target);'));
  const selector = home.split('const nested = target?.closest(')[1]?.split(';')[0] ?? "";
  assert.ok(!selector.includes("'button,"), "forecast day buttons must not block city swipe");
  assert.ok(selector.includes(".overflow-x-auto"), "nested hourly ribbon must handle its own gestures");
});
test("cyclic atmospheric cloud field draws over fractional WebView seam", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  assert.ok(sky.includes('const overlap = 1 / dpr'));
  assert.ok(sky.includes('ctx.drawImage(field.canvas, x0, 0, dw + overlap, dh)'));
  assert.ok(sky.includes('ctx.drawImage(field.canvas, x0 + span, 0, dw + overlap, dh)'));
});
test("rain spatial failures reduce fallback delay without extra grid budgets", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(map.includes('}, 4500);'));
  assert.ok(map.includes('modelRef.current?.isSpatialVisible()'));
  assert.ok(map.includes('const budget = 4200;'));
});

test("GPS preview navigation never persists as a saved city", () => {
  const home = read("project/src/components/weather/HomeScreen.tsx");
  assert.ok(home.includes("citySwipeOrder(places.map((p) => p.id), gpsPreview?.id, peek?.id)"));
  assert.ok(home.includes("else if (gpsPreview?.id === target) locatePlace(gpsPreview)"));
  assert.ok(!home.includes("addPlace(gpsPreview)"));
});

test("rain/snow hero visuals remain conditional on real weather code and clipped to sky", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const css = read("project/src/styles.css");
  const app = read("project/src/components/weather/WeatherApp.tsx");
  assert.ok(sky.includes('heroAtmosphere(code, cover, wind)'));
  assert.ok(sky.includes('plan.precipitation === "snow"'));
  assert.ok(sky.includes('if (plan.precipitation !== "none")'));
  assert.ok(app.includes('heroWeather={tab === "home" && !placesOpen'));
  assert.ok(css.includes('height: 11.5rem'));
});

test("wind zoom transitions reset obsolete trails without changing wind physics", () => {
  const engine = read("project/src/weather/glField.ts");
  assert.ok(engine.includes('map.on("zoomend", this.onZoom)'));
  assert.ok(engine.includes('this.map?.off("zoomend", this.onZoom)'));
  assert.ok(engine.includes('if (this.kind === 0) for (const p of this.particles) p.trail.length = 0'));
  assert.ok(engine.includes("this.windStep(lat, lon, cur"));
});

test("source-backed rain fallback can play while full ECMWF decodes; no fake or stale layer", () => {
  const model = read("project/src/weather/modelField.ts");
  const engine = read("project/src/weather/glField.ts");
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(engine.includes('hasSourceRain(): boolean'));
  assert.ok(engine.includes('!grid.id.startsWith("est|")'));
  assert.ok(model.includes("setSourceBackedFallback(available: boolean)"));
  assert.ok(model.includes("this.sourceBackedFallback && !readySteps.has(this.base)"));
  assert.ok(model.includes("completedOpacity >= 0.88"), "cloud preview must not hide real rain/snow fallback");
  assert.ok(map.includes("rainPlaybackQuickRef.current?.()"));
  assert.ok(map.includes("engine.hasSourceRain()"));
  assert.ok(map.includes("info.playbackWaitingMs >= 1800"));
});

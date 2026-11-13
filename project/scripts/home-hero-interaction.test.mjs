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
  assert.ok(sky.includes("heroWeather ? <HeroPrecipitation"), "retain only weather-driven precipitation in sky scene");
  assert.ok(app.includes('heroWeather={tab === "home" && !placesOpen && bundle?.placeId === place.id}'));
  assert.ok(style.includes(".wx-hero-atmosphere") && style.includes("pointer-events: none;"));
  assert.ok(style.includes("height: calc(var(--sat, env(safe-area-inset-top, 0px)) + 14.1rem + 5mm)"), "precipitation follows the cloud deck, not half the screen");
});

test("hero weather scene is bounded to low frame rate, pauses outside viewport and supports accessibility", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  for (const phrase of [
    'data-hero-weather="precipitation-only"', 'IntersectionObserver', 'document.hidden',
    'prefers-reduced-motion: reduce', 'ResizeObserver', 'window.setTimeout', '65)',
    'heroAtmosphere(code, cover, wind)', 'if (plan.precipitation === "none") return;',
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
  assert.ok(hero.includes("top: 0;"), "rain/snow start at the cloud ceiling, not halfway down the screen");
  assert.ok(hero.includes("height: calc(var(--sat, env(safe-area-inset-top, 0px)) + 14.1rem + 5mm)"), "weather is restricted to cloud-deck height");
  assert.ok(hero.includes("rgb(0 0 0 / 0.36) 5%") && hero.includes("#000 19%"), "upper rain/snow materializes smoothly through the cloud deck");
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
  assert.ok(sky.includes("heroWeather ? <HeroPrecipitation"), "local rain/snow is drawn apart from unified cloud field");
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
  assert.ok(css.includes('height: calc(var(--sat, env(safe-area-inset-top, 0px)) + 14.1rem + 5mm)'));
});

test("wind zoom transitions reset obsolete trails without changing wind physics", () => {
  const engine = read("project/src/weather/glField.ts");
  assert.ok(engine.includes('map.on("zoomend", this.onZoom)'));
  assert.ok(engine.includes('this.map?.off("zoomend", this.onZoom)'));
  assert.ok(engine.includes("if (this.kind === 0) this.particles.length = 0"), "pan and zoom must release obsolete particle positions, not only tails");
  assert.ok(engine.includes("this.windStep(lat, lon, cur"));
});

test("source-backed rain fallback can play while full ECMWF decodes; no fake or stale layer", () => {
  const model = read("project/src/weather/modelField.ts");
  const engine = read("project/src/weather/glField.ts");
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(engine.includes('hasSourceRain(): boolean'));
  assert.ok(engine.includes('!grid.id.startsWith("est|")'));
  assert.ok(model.includes("setSourceBackedFallback(available: boolean)"));
  assert.ok(model.includes("chooseWeatherSource(readySteps.has(this.base), this.sourceBackedFallback"), "actual fallback is selected only when current ECMWF data are incomplete");
  assert.ok(model.includes("completedOpacity >= 0.88"), "cloud preview must not hide real rain/snow fallback");
  assert.ok(map.includes("rainPlaybackQuickRef.current?.()"));
  assert.ok(map.includes("engine.hasSourceRain()"));
  assert.ok(map.includes("info.playbackWaitingMs >= 1800"));
});

test("a missing rain grid uses a stable forecast time reference, never Date.now per tick", () => {
  const engine = read("project/src/weather/glField.ts");
  const helper = read("project/src/weather/weatherPlayback.ts");
  assert.ok(engine.includes("this.rainForecastTime(grid, candidate)"));
  assert.ok(engine.includes("this.rainForecastTime(grid, this.hour)"));
  assert.ok(helper.includes("rainClockWithoutGrid(startMs: number, hour: number)"));
  assert.ok(engine.includes("if (usable(this.global)) return this.global;"), "real global data must also meet visible raster-quality constraints");
});

test("regression: map does not mount PR81 duplicate safety grids or defer spatial frames during dragging", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  const model = read("project/src/weather/modelField.ts");
  const wind = read("project/src/weather/glField.ts");
  assert.ok(map.includes("const underlay = L.tileLayer(imageryUrl"));
  assert.ok(!map.includes("underlay4") && !map.includes("underlay5"));
  assert.ok(!model.includes("canReuseSpatialWindow(this.decodeWindow"), "never reuse a stale OM decode window");
  assert.ok(!model.includes("mapInteractions > 0"), "do not freeze frame scheduler after unmatched Leaflet events");
  assert.ok(!wind.includes("now - this.last < 32"), "never throttle wind by incorrectly skipping map animation frames");
});

test("regression: fallback and ECMWF are switched atomically, not alpha-composited into rectangular artifacts", () => {
  const model = read("project/src/weather/modelField.ts");
  assert.ok(model.includes("chooseWeatherSource(readySteps.has(this.base)"));
  assert.ok(model.includes("const preview = !fallbackForHour && !cooldown"), "only show cloud preview when no incompatible fallback product is visible");
  assert.ok(model.includes("(!fallbackForHour || idx === 0)"), "never duplicate fallback rain/snow with partial ECMWF precipitation");
  assert.ok(model.includes("fallbackForHour || returningToReadyModel ? goal"));
  assert.ok(model.includes("!fallbackForHour && this.diagnosticMode"));
});

test("regression: wind particles reproject to nearest world and reset trails at pan start", () => {
  const wind = read("project/src/weather/glField.ts");
  assert.ok(wind.includes("nearestWorldLongitude(lon, map.getCenter().lng)"));
  assert.ok(wind.includes('map.on("movestart", this.onMoveStart)'));
  assert.ok(wind.includes('this.map?.off("movestart", this.onMoveStart)'));
  assert.ok(wind.includes("for (const p of this.particles) p.trail.length = 0"));
});

test("ECMWF remains visible through short playback seeks; real-data fallback activates only after bounded wait", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(map.includes("const hasRealRain = engine.hasSourceRain()"));
  assert.ok(map.includes("!engine.playing || !modelRef.current?.isSpatialVisible()"));
  assert.ok(map.includes("info.playbackWaitingMs >= 1600"));
  assert.ok(map.includes("setSourceBackedFallback(needFallback)"));
});

test("wind flings replenish the VISIBLE viewport rather than keeping an old offscreen particle budget", () => {
  const engine = read("project/src/weather/glField.ts");
  const start = engine.split("private onMoveStart = () => {")[1]?.split("  private onMove =")[0];
  const settle = engine.split("private onMove = () => {")[1]?.split("  private onZoom =")[0];
  assert.ok(start?.includes("this.particles.length = 0"), "pan start discards outdated particle positions");
  assert.ok(settle?.includes("this.particles.length = 0"), "after inertia the new viewport is fully seeded");
  assert.ok(settle?.includes("this.drawParticles(0)"), "draw new positions without waiting for old lifetimes");
  assert.ok(engine.includes("const bornCap = 110"), "bounded seeding avoids a single-frame CPU spike");
});

test("fallback rain grid cells must not become large blurry polygons after zoom", () => {
  const field = read("project/src/weather/glField.ts");
  const quality = read("project/src/weather/rainRasterQuality.ts");
  assert.ok(field.includes("usablePrecipitationGrid(") && field.includes("grid.lonSpan, grid.cols"), "verify geographic resolution before drawing fallback");
  assert.ok(field.includes("if (usable(world)) return world;"));
  assert.ok(field.includes("if (usable(this.detail) && this.detailFillsView(this.detail))"));
  assert.ok(quality.includes("Math.max(horizontalPixels, verticalPixels) <= maxCellPixels"), "rain resolution must account for longitude and latitude scale");
  assert.ok(field.includes('!grid.id.startsWith("est|")'), "no estimated rain tiles");
});

test("wind streamline seeds and per-frame advection share one Mercator-correct projection", () => {
  const engine = read("project/src/weather/glField.ts");
  const seed = engine.split("private seedWindTrail(")[1]?.split("private spawnRain(")[0];
  assert.ok(seed?.includes("windScreenStepDegrees(la, zoom, 2.4, 1)"));
  assert.ok(engine.includes("windScreenStepDegrees(lat, zoom, pxPerSec, dt)"));
  assert.ok(!seed?.includes("lo -= ((cur.u / mag) * deg) / cos"));
});

test("map painting performs only one viewport projection for each wind/temperature frame", () => {
  const src = read("project/src/weather/glField.ts");
  const frame = src.split("private frame = (now: number) => {")[1]?.split("private emit()")[0] ?? "";
  assert.ok(frame.includes("if (cycloneDue && !fallbackDue) this.pinView()"), "only cyclone-only frames need a separate viewport sync");
  assert.ok(frame.includes("if (fallbackDue) {") && frame.includes("this.drawField()"), "normal frame draws must keep working");
  assert.ok(src.includes("private drawField() {") && src.includes("this.syncViewport()"), "field painting still uses current map geometry");
});

test("loaded ECMWF tiles avoid a second rectangular alpha fade on top of frame-level interpolation", () => {
  const css = read("project/src/styles.css");
  assert.ok(css.includes("Weather tiles must use Leaflet\'s own loaded-tile opacity"), "native loaded-tile renderer owns opacity");
  assert.ok(!css.includes("transition: opacity 160ms ease-out;"), "remove duplicate tile-level alpha fades");
  assert.ok(!css.includes("transition: opacity 160ms ease-out"), "use only Leaflet and ECMWF frame-level fading");
  assert.ok(css.includes("@media (prefers-reduced-motion: reduce)"), "existing reduced-motion support remains");
  const model = read("project/src/weather/spatialTilePolicy.ts");
  assert.ok(model.includes("updateWhenIdle: true") && model.includes("keepBuffer: 1"));
});

test("rain regional fallback starts slightly sooner after release without changing source budgets", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(map.includes("window.setTimeout(pullView, 220)"));
  assert.ok(map.includes("viewAc?.abort()"));
  assert.ok(map.includes("modelRef.current?.isSpatialVisible()"));
  assert.ok(map.includes("const budget = 4200;"));
});

test("map raster city labels no longer stretch during pinch and do not steal initial imagery requests", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  const labels = read("project/src/weather/rasterZoomLabels.ts");
  assert.ok(map.includes("manageRasterZoomLabels(map, labelTiles, labels"));
  assert.ok(map.includes("updateWhenIdle: true, updateWhenZooming: false"), "labels update on settled view only");
  assert.ok(map.includes('imagery.on("tileload", mountLabels)'), "request satellite imagery before optional label tiles");
  assert.ok(map.includes('window.setTimeout(mountLabels, 800)'), "bounded initial label delay");
  assert.ok(map.includes('window.clearTimeout(labelMountTimer)'), "no background callback after map unload");
  assert.ok(labels.includes('map.on("zoomstart", onZoomStart)'));
  assert.ok(labels.includes('map.on("zoomend", onZoomEnd)'));
  assert.ok(labels.includes('layer.isLoading()'), "wait for actual raster labels, not arbitrary timeout");
  assert.ok(labels.includes('map.on("unload", dispose)'), "event handlers released on map removal");
});

test("weather hero uses one atmospheric cloud generator, with precipitation-only upper-band animation", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const css = read("project/src/styles.css");
  const model = read("project/src/weather/modelField.ts");
  assert.ok(sky.includes("showClouds ? <CloudField"), "one ambient weather-dependent cloud field");
  assert.ok(sky.includes("heroWeather ? <HeroPrecipitation"), "real state controls upper rain and snow");
  assert.ok(!sky.includes("heroCloudTextures") && !sky.includes("heroSpriteCache"), "no repeated cloud sprite attached to temperature text");
  assert.ok(!sky.includes("for (let i = 0; i < plan.clouds"), "no second cloud bank loop");
  assert.ok(sky.includes("const density = heroAtmosphere(code, cover, 0).coverage"), "cloud transparency adapts to city WMO and cover");
  assert.ok(sky.includes('if (heroAtmosphere(code, cover, wind).precipitation === "none") return null'), "no empty precip animation in sunny cities");
  assert.ok(sky.includes('plan.precipitation === "snow"'), "snow retains existing weather-specific particle type");
  assert.ok(css.includes("height: calc(var(--sat, env(safe-area-inset-top, 0px)) + 14.1rem + 5mm)"), "precip stays clipped to the cloud-deck region");
  assert.ok(css.includes("opacity: var(--wx-cloud-scroll-opacity, 1)"), "sky and precipitation scroll away gradually");
  assert.ok(model.includes("const preview = !fallbackForHour && !cooldown"), "never composite partial ECMWF cloud tiles over different fallback model");
  assert.ok(!model.includes("coldCloudPreview"), "no mixed-source first-paint exception");
});

test("map viewport reveal stages new ECMWF tiles and retains a coarser satellite floor", () => {
  const map = read("project/src/components/weather/MapScreen.tsx");
  const src = read("project/src/weather/modelField.ts");
  const queue = read("project/src/weather/modelFrameQueue.ts");
  const satellite = read("project/src/weather/satelliteBasemap.ts");
  assert.ok(src.includes('tileGate.hold(event.tile as SpatialTileNode)'));
  assert.ok(src.includes('layer.on("load", () => {') &&
    src.includes("frame.tileGates.forEach((gate) => gate.release())"));
  assert.ok(src.includes("frame.renderGeneration.ready() && frame.loaded.every(Boolean)"),
    "stage release must wait for the whole ECMWF viewport or a tile error");
  assert.ok(src.includes('layer.on("tileunload", (event)'));
  assert.ok(src.includes("canStageSpatialRefresh(lastCompletedView, rasterView())"),
    "stage only same-zoom small-area updates; show new pixels immediately on large pans");
  assert.ok(src.includes("frame.tileGates.forEach((gate) => gate.release());"),
    "previous held tiles cannot survive an invalidated viewport");
  assert.ok(src.includes('map.on("move", onMove)'));
  assert.ok(src.includes('significantSpatialMove(origin,'));
  assert.ok(queue.includes("const cancel = deferred ? []"));
  assert.ok(satellite.includes("SATELLITE_UNDERLAY_NATIVE_ZOOM = 4"));
  assert.ok(map.includes("maxNativeZoom: SATELLITE_UNDERLAY_NATIVE_ZOOM"));
});

test("visible ECMWF viewport interrupts obsolete prefetch and stages nonblocking snowfall", () => {
  const src = read("project/src/weather/modelField.ts");
  const scheduler = read("project/src/weather/modelFrameQueue.ts");
  assert.ok(src.includes('map.on("movestart", onMoveStart)'));
  assert.ok(src.includes('map.on("moveend", onMoveEnd)'));
  assert.ok(src.includes('if (step !== this.base) this.discardFrame(step)'));
  assert.ok(src.includes('this.viewportMoving || now < this.viewportHoldUntil'));
  assert.ok(src.includes('this.map.off("movestart", this.moveStartListener)'));
  assert.ok(src.includes('if (frame?.snowStartTimer !== undefined) window.clearTimeout(frame.snowStartTimer)'));
  assert.ok(src.includes('if (index < 2) layer.addTo(map)'));
  assert.ok(src.includes('frame.snowStartTimer = window.setTimeout(mountSnow, 650)'));
  assert.ok(src.includes('made[0]!.on("tileload", mountSnow)'));
  assert.ok(scheduler.includes("visibleRefreshAgeMs < grace"));
  assert.ok(src.includes("const ready = spatialFrameReadyDuringRefresh("),
    "keep previously rendered ECMWF field while only a viewport refresh is pending");
  assert.ok(src.includes("const preview = !fallbackForHour && !cooldown"),
    "never overlay an incompatible fallback beneath partial ECMWF weather");
});

test("cloud field uses seamless single-pass pattern and moon respects the city's horizon", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const app = read("project/src/components/weather/WeatherApp.tsx");
  const astro = read("project/src/weather/astro.ts");
  assert.ok(sky.includes('ctx.createPattern(field.canvas, "repeat")'), "one continuously repeated cloud texture");
  assert.ok(sky.includes("x / (w - 1)"), "cloud edges match in the periodic texture");
  assert.ok(!sky.includes("const overlap = 1 / dpr"), "no double-alpha cloud seam");
  assert.ok(sky.includes("!day && moonVisible"), "night sky does not imply moon above horizon");
  assert.ok(app.includes("moonAboveHorizon(place.lat, place.lon, clock)"));
  assert.ok(astro.includes("return moonAlt(now, lat, lon) > 0"));
});

test("home sky renders gently but never competes with weather map tile decoding offscreen", () => {
  const sky = read("project/src/components/weather/SkyBackdrop.tsx");
  const app = read("project/src/components/weather/WeatherApp.tsx");
  assert.ok(app.includes('animateClouds={tab === "home" && !placesOpen}'));
  assert.ok(sky.includes('animate={animateClouds}'));
  assert.ok(sky.includes("if (!alive || !animate || document.hidden) return"), "no animation under foreground map or hidden tab");
  assert.ok(sky.includes("window.setTimeout(() => {") && sky.includes("}, 25);"), "bounded 24fps cloud drift, not continuous 60fps repaint");
  assert.ok(sky.includes('document.addEventListener("visibilitychange", onVisibility)'));
  assert.ok(sky.includes('document.removeEventListener("visibilitychange", onVisibility)'));
  assert.ok(sky.includes("pause();") && sky.includes("ro.disconnect();"));
});
test("one viewport generation publishes consistent model layers and retains satellite parent tiles", () => {
  const src = read("project/src/weather/modelField.ts");
  const generation = read("project/src/weather/spatialRenderGeneration.ts");
  const map = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(src.includes("frame.renderGeneration.begin(incomplete)"),
    "a gesture must adopt unfinished layers rather than dropping their load events");
  assert.ok(src.includes("frame.layerGeneration[index] = adopted"));
  assert.ok(src.includes("frame.renderGeneration.loaded(index, frame.layerGeneration[index]!)"));
  assert.ok(src.includes("frame.renderGeneration.ready() && frame.loaded.every(Boolean)"));
  assert.ok(generation.includes("for (const index of inFlight) this.started.add(index)"));
  assert.ok(src.includes("layer.isLoading?.() !== false"), "only real settled Leaflet queues may be recovered");
  assert.ok(map.includes("shouldKeepSatelliteParent(map.getZoom(), detailedReady)"));
  assert.ok(map.includes('imagery.on("load", () => { detailedReady = true; syncUnderlay(); })'));
});

test("ECMWF viewport renderer reuses decoded data, limits retained states and supports rollback", () => {
  const model = read("project/src/weather/modelField.ts");
  const engine = read("project/src/weather/spatialViewportRenderer.ts");
  const worker = read("project/src/weather/spatialViewportRaster.worker.ts");
  const screen = read("project/src/components/weather/MapScreen.tsx");
  assert.ok(model.includes("maxStatesWithData: 6"), "three current + three playback states must stay cached");
  assert.ok(model.includes('new SpatialViewportRenderer(this.compactSpatialTiles && !legacyOverride)'));
  assert.ok(model.includes('this.viewportRenderer?.handler ?? omProtocol'));
  assert.ok(model.includes('this.viewportRenderer?.dispose()'));
  assert.ok(engine.includes('type: "arrayBuffer"'), "decode OM through official protocol without duplicate first-tile paint");
  assert.ok(engine.includes("MAX_WORKER_DATA = 24 * 1024 * 1024"), "bounded worker memory");
  assert.ok(engine.includes('slot.cache.has(job.dataKey)'), "reuse decoded raster data across tiles");
  assert.ok(worker.includes("GridFactory.create"), "preserve official ECMWF grid interpolation");
  assert.ok(screen.includes("viewportRenderer.renderP95Ms"), "render timing must be visible to QA");
});

test("mobile weather displays complete same-run ECMWF layers without per-variable first-paint succession", () => {
  const src = read("project/src/weather/modelField.ts");
  const policy = read("project/src/weather/spatialTilePolicy.ts");
  const planner = read("project/src/weather/modelFrameQueue.ts");
  assert.ok(policy.includes("COMPACT_SPATIAL_TILE_SIZE = 1024"));
  assert.ok(src.includes("useCompactSpatialTiles(nativeApp(), globalThis.crossOriginIsolated === true)"));
  assert.ok(src.includes("tile_size=${COMPACT_SPATIAL_TILE_SIZE}"));
  assert.ok(src.includes("const preview = !this.compactSpatialTiles &&"));
  assert.ok(src.includes("frame.renderGeneration.ready() && frame.loaded.every(Boolean)"),
    "small viewport reveals must be synchronized across all 3 layers");
  assert.ok(planner.includes("playbackActive ? requested + 1 : -1"));
});

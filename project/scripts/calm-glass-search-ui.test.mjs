import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const css=read("src/styles.css"),settings=read("src/components/weather/SettingsScreen.tsx");
const map=read("src/components/weather/MapScreen.tsx"),city=read("src/components/weather/CitiesScreen.tsx");
const api=read("src/weather/api.ts");
test("tap controls remain at least 48px even though toggle track is slim",()=>{
 assert.ok(settings.includes('grid h-12 w-12')&&settings.includes('min-h-11 w-full'));
 assert.match(css,/\.wx-settings-toggle \.wx-toggle-track\s*\{[^}]*width: 2\.65rem/s);
 assert.ok(css.includes('[dir="rtl"] .wx-settings-toggle[aria-checked="true"]'));
});
test("compact licensing credit is docked immediately above playback card, not absolute",()=>{
 const credit=map.indexOf('className="wx-map-source-credit');
 const dock=map.indexOf('className="map-dock');
 const bar=map.indexOf('className="wx-card map-bar');
 assert.ok(dock>=0&&credit>dock&&bar>credit);
 const block=css.slice(css.indexOf(".wx-map-source-credit {"),css.indexOf(".wx-map-source-credit a {"));
 assert.ok(block.includes("position: relative"));
 assert.doesNotMatch(block, /(?:^|\n)\s*bottom\s*:/, "credit cannot have an absolute bottom offset");
 assert.ok(map.includes("https://www.esri.com/")&&map.includes("https://open-meteo.com/en/license"));
});
test("source disclosure stays available and the homepage/map settings are preserved",()=>{
 for(const token of ['setPrefs({ mapLayer','setPrefs({ refreshMin','setPrefs({ alerts','clearCache()'])assert.ok(settings.includes(token));
 assert.ok(settings.includes("<details")&&settings.includes('wx-sources-summary'));
 assert.ok(css.includes("color-mix(in srgb, var(--wx-card-base) 80%, transparent)"));
 assert.ok(css.includes("color-mix(in srgb, var(--wx-card-base) 81%, transparent)"));
 assert.ok(settings.includes("wx-setting-field-inline"));
 assert.ok(settings.includes('DESIGN_REVISION') && settings.includes('ANDROID_BUILD_CODE'));
});
test("city UI permits 2 characters, keeps current results, cancels superseded requests",()=>{
 assert.ok(city.includes("Array.from(q).length < 2"));
 assert.ok(city.includes('className="wx-card wx-city-results') && city.includes('!hasTerm ? ('));
 assert.ok(city.includes("onUpdate")||city.includes("rows=>"));
 assert.ok(city.includes("if(current&&!ac.signal.aborted)"));
 assert.ok(city.includes("mergeCityResults(q,local,remote.query===q?remote.hits:[])"));
 assert.ok(api.includes("mergeCityResults")&&api.includes("relaxedCityQuery"));
 assert.ok(api.includes("cacheCities(key,result)"));
 assert.ok(api.includes("if(Array.from(trimmed).length===2)return local"));
 assert.ok(api.includes("exactAlias"));
});

test("build label agrees with Gradle versionCode so stale APKs are obvious",()=>{
 const info=read("src/weather/buildInfo.ts"),gradle=read("android/app/build.gradle");
 const code=info.match(/ANDROID_BUILD_CODE = (\d+)/)?.[1];
 assert.ok(code && gradle.includes("versionCode "+code));
 assert.ok(settings.includes('Build {ANDROID_BUILD_CODE}'));
});
test("Prague full-name result visibility is protected even when provider is offline",()=>{
 const seeds=read("src/weather/places-index.ts");
 assert.ok(seeds.includes('["Prague", "براغ"'));
 assert.ok(city.includes("mergeCityResults(q,local,remote.query===q?remote.hits:[])"));
 assert.ok(city.includes("hits.length > 0 ? hits.map"));
 assert.ok(city.includes('role="status"'));
});

test("map playback header uses one centered time row with a dedicated value",()=>{
 const row=map.slice(map.indexOf('wx-map-playback-meta'));
 assert.ok(row.includes('ref={timeRef}')&&row.includes('ref={valueRef}'));
 assert.ok(row.indexOf('ref={timeRef}')<row.indexOf('ref={valueRef}'));
 assert.ok(row.includes('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'));
 assert.ok(!row.includes('className="block text-[0.65rem] leading-tight text-muted"'));
});

test("source-clock correction runs AFTER engine sync and diagnostics describe actually visible opacity",()=>{
 const sync=map.indexOf("modelRef.current?.sync(info.timeMs)");
 const committed=map.indexOf("queueMicrotask",sync);
 const actual=map.indexOf("getMapClock(info.timeMs)",committed);
 assert.ok(sync>=0&&committed>sync&&actual>committed);
 const field=read("src/weather/modelField.ts");
 assert.ok(field.includes("requestedFrameOpacity: frame?.opacity ?? 0"));
 assert.ok(field.includes("contributors.reduce((sum,[,item])"));
});

test("production lookup never hardcodes the public Photon demo host",()=>{
 const cfg=read("src/weather/privateGeocoder.ts");
 assert.ok(cfg.includes("VITE_MYWEATHER_GEOCODER_URL"));
 assert.ok(cfg.includes("photon.komoot.io"));
 assert.ok(!api.includes('new URL("https://photon.komoot.io/api/")'));
 assert.ok(api.includes("configuredPrivateGeocoder&&local.length===0"));
});

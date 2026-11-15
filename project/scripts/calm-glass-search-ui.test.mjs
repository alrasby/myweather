import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const css=read("src/styles.css"),settings=read("src/components/weather/SettingsScreen.tsx");
const map=read("src/components/weather/MapScreen.tsx"),city=read("src/components/weather/CitiesScreen.tsx");
const api=read("src/weather/api.ts");
test("tap controls remain at least 48px even though toggle track is slim",()=>{
 assert.ok(settings.includes('grid h-12 w-12')&&settings.includes('min-h-12 w-full'));
 assert.match(css,/\.wx-settings-toggle \.wx-toggle-track\s*\{[^}]*width: 2\.65rem/s);
 assert.ok(css.includes('[dir="rtl"] .wx-settings-toggle[aria-checked="true"]'));
});
test("compact licensing credit is docked immediately above playback card, not absolute",()=>{
 const credit=map.indexOf('className="wx-map-source-credit');
 const dock=map.indexOf('className="map-dock');
 const bar=map.indexOf('className="wx-card map-bar');
 assert.ok(dock>=0&&credit>dock&&bar>credit);
 const block=css.slice(css.indexOf(".wx-map-source-credit {"),css.indexOf(".wx-map-source-credit a {"));
 assert.ok(block.includes("position: relative")&&!block.includes("bottom:"));
 assert.ok(map.includes("https://www.esri.com/")&&map.includes("https://open-meteo.com/en/license"));
});
test("source disclosure stays available and the homepage/map settings are preserved",()=>{
 for(const token of ['setPrefs({ mapLayer','setPrefs({ refreshMin','setPrefs({ alerts','clearCache()'])assert.ok(settings.includes(token));
 assert.ok(settings.includes("<details")&&settings.includes('wx-sources-summary'));
 assert.ok(css.includes("color-mix(in srgb, var(--wx-card-base) 94%, transparent)"));
});
test("city UI permits 2 characters, keeps current results, cancels superseded requests",()=>{
 assert.ok(city.includes("Array.from(q).length < 2"));
 assert.ok(city.includes("onUpdate")||city.includes("rows=>"));
 assert.ok(city.includes("if(current&&!ac.signal.aborted)"));
 assert.ok(city.includes("remote.query===q?remote.hits:local"));
 assert.ok(api.includes("mergeCityResults")&&api.includes("relaxedCityQuery"));
 assert.ok(api.includes("cacheCities(key,result)"));
});

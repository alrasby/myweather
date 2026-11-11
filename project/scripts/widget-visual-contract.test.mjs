import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const widgetLayouts = [
 "widget_2x1.xml", "widget_2x2.xml", "widget_2x2_clock.xml",
 "widget_4x1.xml", "widget_4x1_clock.xml",
 "widget_4x2.xml", "widget_4x2_clock.xml",
];
const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("all widget variants allow wallpaper through the generated glass bitmap", () => {
 for (const name of widgetLayouts) {
  const xml=read("project/android/app/src/main/res/layout/"+name);
  assert.ok(xml.includes('android:background="@android:color/transparent"'), name);
  assert.ok(!xml.includes('android:background="@drawable/widget_glass_bg"'), name);
  assert.match(xml, /android:id="@\+id\/bg"/, name);
 }
});
test("color selection is independent from background alpha and exposed in configuration", () => {
 const java=read("project/android/app/src/main/java/net/nabdhserv/myweather/WeatherWidget.java");
 const config=read("project/android/app/src/main/java/net/nabdhserv/myweather/WidgetSettingsActivity.java");
 const xml=read("project/android/app/src/main/res/layout/activity_widget_settings.xml");
 assert.ok(java.includes('case "blue"'));
 assert.ok(java.includes('KEY_TONE'));
 assert.ok(java.includes('KEY_STRENGTH'));
 assert.ok(!java.includes('Math.max(a, 188)'));
 assert.ok(config.includes('WeatherWidget.KEY_TONE'));
 assert.ok(config.includes('WeatherWidget.KEY_STRENGTH'));
 for(const id of ["tintBlue","tone","strength","glassPreview"]) assert.ok(xml.includes('@+id/'+id), id);
});
test("mobile map no longer expands raster to 257px or adds bleed class", () => {
 const css=read("project/src/styles.css");
 const map=read("project/src/components/weather/MapScreen.tsx");
 assert.doesNotMatch(css, /width:\s*257px\s*!important/);
 assert.ok(!map.includes('el.classList.add("wx-android-raster-bleed")'));
});

test("widget offers automatic OS palette and readable monochrome glass presets", () => {
 const java = read("project/android/app/src/main/java/net/nabdhserv/myweather/WeatherWidget.java");
 const config = read("project/android/app/src/main/java/net/nabdhserv/myweather/WidgetSettingsActivity.java");
 const xml = read("project/android/app/src/main/res/layout/activity_widget_settings.xml");
 const manifest = read("project/android/app/src/main/AndroidManifest.xml");
 assert.ok(java.includes('"white".equals(choice)'), "white preset");
 assert.ok(java.includes('"black".equals(choice)'), "black preset");
 assert.ok(java.includes('system_accent1_500'), "system Material You palette");
 assert.ok(java.includes('Intent.ACTION_WALLPAPER_CHANGED'), "update when wallpaper changes");
 assert.ok(manifest.includes('android.intent.action.WALLPAPER_CHANGED'));
 for (const id of ["tintAdaptive", "tintWhite", "tintBlack"]) {
   assert.ok(xml.includes("@+id/" + id), id);
   assert.ok(config.includes("R.id." + id), id);
 }
});
test("public map omits the information icon but preserves hidden diagnostics", () => {
 const map = read("project/src/components/weather/MapScreen.tsx");
 assert.ok(!map.includes('className="text-lg font-semibold">ⓘ'), "no visible diagnostic icon");
 assert.ok(map.includes('rainTapRef.current'), "keep private triple-tap diagnostics");
});

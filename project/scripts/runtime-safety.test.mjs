import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");

test("adaptive widget foreground is independent of weather-condition glyphs", () => {
  const widget = read("project/android/app/src/main/java/net/nabdhserv/myweather/WeatherWidget.java");
  const glyph = read("project/android/app/src/main/java/net/nabdhserv/myweather/WeatherGlyphs.java");
  assert.ok(widget.includes("widgetTextColor(context, tint, dark)"));
  assert.ok(widget.includes('return glassTint("adaptive".equals(choice) ? "ocean" : choice'));
  assert.ok(glyph.includes('"#78ACCE"'));
  assert.ok(glyph.includes('"#2799E0"'));
});
test("long wind threads remain bounded and rendered with one faded gradient stroke", () => {
  const wind = read("project/src/weather/glField.ts");
  assert.ok(wind.includes("this.trimTrail(p, 38)"));
  assert.ok(wind.includes("p.trail.length > 14"));
  assert.ok(wind.includes("ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)"));
  assert.ok(wind.includes("ctx.quadraticCurveTo"));
  assert.ok(wind.includes("setSaver(on: boolean)"));
});
test("native activity releases sensor, WebView and message queue on destruction", () => {
  const activity = read("project/android/app/src/main/java/net/nabdhserv/myweather/MainActivity.java");
  assert.ok(activity.includes("public void onDestroy()"));
  for (const item of ["compass.dispose()", "main.removeCallbacksAndMessages(null)", "web = null",
    "SENSOR_DELAY_UI", "sensors.unregisterListener(this)"]) assert.ok(activity.includes(item),item);
  const model = read("project/src/weather/modelField.ts");
  const map = read("project/src/components/weather/MapScreen.tsx");
  for (const item of ["dispose() {", "metadataAbort?.abort()", "this.clear()", "this.map = null"]) {
    assert.ok(model.includes(item),item);
  }
  assert.ok(map.includes("modelRef.current?.dispose()"));
  assert.ok(map.includes("engine.destroy()"));
});
test("Android manifest and file provider enforce least privilege", () => {
  const manifest = read("project/android/app/src/main/AndroidManifest.xml");
  const sharing = read("project/android/app/src/main/res/xml/file_paths.xml");
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'));
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.ok(sharing.includes("<external-files-path"));
  assert.ok(!sharing.includes("<external-path"));
  for (const forbidden of ["RECORD_AUDIO","READ_SMS","ACCESS_BACKGROUND_LOCATION","READ_CONTACTS",
    "QUERY_ALL_PACKAGES","REQUEST_INSTALL_PACKAGES"]) {
    assert.ok(!manifest.includes("android.permission." + forbidden), forbidden);
  }
});
test("weather transport and proxy reject SSRF redirects and excess memory demand", () => {
  const proxy = read("project/src/weather/proxy.functions.ts");
  const queue = read("project/src/weather/net.ts");
  assert.ok(proxy.includes('redirect: "error"'));
  assert.ok(proxy.includes("MAX_CONCURRENT = 8"));
  assert.ok(proxy.includes("MAX_BODY_BYTES = 4_000_000"));
  assert.ok(proxy.includes("reader.cancel()"));
  assert.ok(queue.includes("MAX_WAITERS = 64"));
  assert.ok(queue.includes('signal?.addEventListener("abort", onAbort'));
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = (...parts) => resolve(import.meta.dirname, "..", ...parts);
const required = [
  "project/package-lock.json",
  "project/package.json",
  "project/src/weather/net.ts",
  "project/src/weather/grid.ts",
  "project/src/weather/geo.ts",
  "project/src/components/weather/MapScreen.tsx",
  "project/android/app/build.gradle",
  "project/android/gradle/wrapper/gradle-wrapper.properties",
  "project/android/gradle/wrapper/gradle-wrapper.jar",
  "project/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
  "connection-tests.mjs",
  "map-tests.mjs",
  "precip-data-tests.mjs",
];
const missing = required.filter((file) => !existsSync(path(file)));
assert.equal(missing.length, 0, `Source archive import incomplete: ${missing.join(", ")}`);

const gradle = readFileSync(path("project/android/app/build.gradle"), "utf8");
for (const pattern of [
  /applicationId\s+["']net\.nabdhserv\.myweather["']/,
  /versionCode\s+51\b/,
  /versionName\s+["']1\.0\.50["']/,
]) assert.match(gradle, pattern);

const wrapper = readFileSync(path("project/android/gradle/wrapper/gradle-wrapper.properties"), "utf8");
assert.match(wrapper, /gradle-8\.14\.3-/);

const preview = readFileSync(path("project/src/lib/auth/preview.ts"), "utf8");
assert.doesNotMatch(preview, /PREVIEW_CLIENT_SECRET\\s*=\\s*["'][^"']{10,}["']/, "Do not publish a hard-coded preview client secret");

const cap = readFileSync(path("project/capacitor.config.ts"), "utf8");
assert.match(cap, /net\.nabdhserv\.myweather/);

for (const secret of [
  "project/android/keystore.properties",
  "project/android/release.jks",
  "project/android/local.properties",
]) assert.equal(existsSync(path(secret)), false, `Do not commit secret/local file: ${secret}`);

console.log("MyWeather 1.0.50 / build 51 source identity verified.");

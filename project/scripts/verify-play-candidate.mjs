/** Fail-closed preflight for the *source* of a Play submission.
 * This is not a substitute for Google Play acceptance, licensing, or
 * permissions review. Signed APK/AAB/target SDK are checked in CI separately.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read=(p)=>readFileSync(p,"utf8");
const gradle=read("project/android/app/build.gradle");
const vars=read("project/android/variables.gradle");
const manifest=read("project/android/app/src/main/AndroidManifest.xml");
const info=read("project/src/weather/buildInfo.ts");
const eot=read("project/src/weather/eot20TideClient.ts");
const workflow=read(".github/workflows/android-play-candidate.yml");

assert.match(gradle,/applicationId "net\.nabdhserv\.myweather"/);
assert.match(gradle,/versionCode 69\b/);
assert.match(gradle,/versionName "1\.0\.0"/);
assert.match(info,/ANDROID_BUILD_CODE = 69\b/);
assert.match(vars,/targetSdkVersion = 36\b/);
assert.match(vars,/compileSdkVersion = 36\b/);
assert.match(manifest,/android:usesCleartextTraffic="false"/);
assert.match(manifest,/android:allowBackup="false"/);
assert.doesNotMatch(manifest,/android\.permission\.ACCESS_BACKGROUND_LOCATION/);
assert.match(eot,/VITE_EOT20_TIDE_ENABLED\s*===\s*"1"/);
assert.match(workflow,/VITE_EOT20_TIDE_ENABLED: "0"/);
assert.equal(process.env.VITE_EOT20_TIDE_ENABLED === "1",false,
 "Do not build a Play candidate with an unlicensed/unverified PyFES atlas");
assert.match(workflow,/if: github\.ref == 'refs\/heads\/main'/);
assert.match(workflow,/tracks: internal/);
assert.match(workflow,/status: draft/);
assert.match(workflow,/changesNotSentForReview: true/);
assert.match(workflow,/default: false/);
assert.doesNotMatch(workflow,/tracks: production/);
assert.match(gradle,/signingConfigs/); // NEVER use an unsigned release in Play
assert.match(gradle,/signingConfig signingConfigs\.release/);
assert.match(workflow,/jarsigner -verify -strict/);
assert.match(workflow,/apksigner" verify/);
assert.match(workflow,/SHA256SUMS\.txt/);
console.log("Play RC1 source gate PASS: package/version/API36, secure manifest, PyFES off, main-only signed AAB + opt-in internal draft.");

# MyWeather UX + Android Auto QA gate (2026-11-12)

## Nonnegotiable release requirements
- Visible version is `1.0.0`; keep Android `versionCode` monotonic (currently 55).
- Keep the phone's approved colors, fonts, dimensions, navigation, map renderer and weather API unchanged.
- On Home, no fixed global cloud canvas: the only animated clouds are inside the scrolling temperature/conditions hero; they leave the screen naturally with the hero, rather than sliding beneath hourly and daily forecast cards.
- Cards retain glass alpha and radius; only soften existing shadows, daily separators, and add a gentle short forecast-panel entrance with `prefers-reduced-motion` respected.
- Android Auto uses a native `CarAppService` with WEATHER category/API level 7, template metadata and restricted release host validation. Its forecast uses existing widget snapshot; no additional background polling.

## Pre-merge automated checks
1. `scripts/verify-import.mjs`, TypeScript, JS/weather regression tests, security audit, Android web sync, Gradle unit tests and Android Lint all pass on the **last** commit.
2. For the PR #78 signed-device-test artifact, use the *same* final head SHA and verify with `apksigner` plus `aapt dump badging` that the APK is `net.nabdhserv.myweather`, display version `1.0.0` and build code 55.
3. Inspect the final APK's merged AndroidManifest and verify `WeatherCarAppService`, `androidx.car.app.category.WEATHER`, the `com.google.android.gms.car.application` template metadata and `minCarApiLevel` 7.
4. Do not promote a run from an earlier commit as proof for the latest head.

## Device checks
- Install the final **PR #78** APK, not the older **PR #77** APK. It is the first combined APK containing the Android Auto service.
- Scroll the 15-day forecast up/down under clear, cloudy and rain conditions: no fixed cloud bank above/behind the cards, no sudden flash, no typography shifts.
- Open/close forecast days; inspect shadows/dividers on light and dark weather scenes, and with Android Reduce Motion enabled.
- Inspect Android Auto developer settings and Desktop Head Unit (DHU); some third-party APK installers do not accurately classify every Car App Library WEATHER app. Car icon discovery alone is not certification.
- Test car template list and stale/missing forecast handling. Confirm the Android Auto host and version support the WEATHER category (Car API 7).
- Android Automotive OS requires separate compatibility tests and possible artifact packaging. Do not claim 100% compatibility or Play approval from CI alone.

**Release policy:** Keep PR #77 and PR #78 unmerged pending screenshot/video and car host test.

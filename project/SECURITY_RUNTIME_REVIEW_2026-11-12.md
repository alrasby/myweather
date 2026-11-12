# MyWeather runtime, privacy, security and performance review — 2026-11-12

## Scope and evidence

This review follows the on-device comparison clip `Screen_Recording_20261112_063924_MyWeather.mp4` (10.2 seconds). The clip juxtaposes Windy wind-flow trails with MyWeather and shows the current wind mode as short white dashes. The native source, weather model lifecycle, widget, permissions and networking code were reviewed. This is **not** a penetration test, live battery benchmark, full dynamic Android memory leak test or a guarantee of absolute protection.

## Changes in this PR

- Weather widget **Adaptive** now controls **typography** using Android's wallpaper-aware neutral text palette. The translucent ocean glass remains independent; weather glyphs draw their own blue/yellow/weather-condition colors and do not inherit adaptive text tint.
- Qibla: localized `تحديث موقعي للقبلة` button uses a subtle surface and spins a refresh icon only while location lookup is in progress.
- Wind: raised geometric trail cap from 14 to 38 CSS px; bounded trail history; curved and tapered strokes. Existing wind field, data source, particle count (240 low, 360 high), velocity, visibility lifecycle and saver policy remain intact.
- Weather data: aborted requests leave the limited queue immediately; queue size and wait time are capped, avoiding stale requests spending the next available connection slot. In ECMWF rain/cloud/snow, metadata fetch is aborted and model tiles/timers/map listeners are released at teardown; stale metadata callbacks can no longer repopulate the disposed model. The .om Content-Length probe cache expires and is bounded at 48 entries. These changes address resource churn without changing the existing ECMWF three-layer forecast animation or point-grid fallback semantics.
- Native lifecycle: `MainActivity.onDestroy` tears down the sensor listener, pending Handler callbacks and WebView reference held by `CompassBridge`; sensor sampling uses `SENSOR_DELAY_UI`, not the higher-rate game sampling.
- Server-side weather proxy: strict HTTPS/upstream host validation, no credentials/custom ports, redirects rejected (SSRF), 8 concurrent requests max per process and max 4 MB streamed response. Note: distributed DDoS protection also requires upstream/provider and hosting edge rate-limits.
- Android privacy: cleartext disabled, app-wide cloud backups disabled (this means previously automatic restore of preferences on reinstall may no longer work), and shared external storage `FileProvider` path narrowed to the app-specific directory; the four declared permissions are Internet, network status and coarse/fine foreground location. No background GPS, microphone, camera, contacts, SMS or storage permissions declared in this app manifest.

## Leak audit

- No application-defined native Android `PlaybackService` class/service is present. Weather playback lives in `FieldEngine.frame` (one `requestAnimationFrame` callback) and `ModelField.sync`. `FieldEngine.destroy()` cancels RAF and removes Leaflet listeners and WebGL textures/context. New `ModelField.dispose()` releases its own retained map/layer/timer references; `MapScreen` now calls it before destroying Leaflet.
- The global spatial transport wrapper remains installed once for the life of the WebView. It is not reinstalled on each screen entry. Spatial requests use cancelable queues, bounded caches and explicit app visibility gating.
- Review found no evidence of a deliberately hidden backdoor or microphone/camera recording path in inspected files. This does **not** rule out all vulnerabilities in the complete dependency tree, Android runtime, upstream providers or platform.

## Quality gates and acceptance

CI runs: full and production npm audit (must report **zero known advisories**), source/type checks, existing functional/weather tests, SSRF regression cases, native resource/permission contracts, Android SDK tests, Android Lint, and signed APK checks on main after merging.

**Still requires device measurement**, using a known Samsung/Android device. Record:
1. Cold app launch and first weather/ECMWF tile load with Wi-Fi/mobile switching.
2. 10 minutes map rain/cloud/snow playback, 10 minutes wind animation, repeated pan/zoom and weather tab changes; observe frames, memory, radio/network, and battery use.
3. Android Studio Memory Profiler or `adb shell dumpsys meminfo net.nabdhserv.myweather` before and after 10–20 screen open/close cycles, then compare **Java heap / native heap / graphics** and verify no upward retained baseline.
4. Battery usage while charging is excluded from consumption estimates; on a controlled discharge interval use `adb shell dumpsys batterystats net.nabdhserv.myweather` and Android Studio Energy Profiler/Perfetto. Compare with prior APK under identical conditions.
5. Verify background app suspends sensor readings and RAF, plus widget colored glyphs on light/dark wallpapers and selected city settings.
6. Check Android merged manifest at build time. Android third-party plugins can contribute permissions at manifest merge; only the app manifest was manually inspected here.

Do not claim fixed memory usage, battery life, 100% security or production OAuth/SSRF immunity from these code checks alone.

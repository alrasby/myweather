# MyWeather security, performance and lifecycle review — 2026-11-12

## Scope and verification limits

Source-level review of Android application/manifest, WebView bridges, the weather proxy, network concurrency, WebGL/ECMWF lifecycle and widget bitmap allocation. Regression tests and Gradle/Android Lint should run in Android CI. **This is not a penetration test, and no security guarantees or measured battery/memory figures are claimed without a running device.**

## Findings and changes

| Area | Finding | Targeted remediation |
| --- | --- | --- |
| Proxy SSRF | Host allowlist existed, but redirects were followed automatically; credentials/custom HTTPS ports were not rejected | Strict HTTPS URL validator; reject unapproved host, credentials/port; `redirect: "error"` stops redirect pivots |
| Proxy resource exhaustion | Server-side `res.text()` could read an unbounded upstream response before truncating it | Streamed max 4,000,000 bytes, reject oversized response, maximum eight in-flight requests per process and 15s upstream deadline |
| Map network queue | Cancelled, queued weather requests could remain; timeout listeners were not always cleaned | Abort-aware FIFO with five active slots/32 queued maximum, release-once semantics and cleaned timeout listeners |
| ECMWF rain/cloud/snow map | Model layer and map listener lacked an explicit teardown path; metadata could remain pending | `ModelField.destroy()` now releases tile layers, timers, callbacks, listener and metadata fetch; metadata deadline 14s, then existing rain fallback remains |
| Native compass Activity | Android sensor and WebView `JavascriptInterface` references could retain an obsolete Activity until WebView teardown | Explicit `onDestroy()` sensor unregister, pending message cancellation, WebView interface removal |
| Native widget memory | Three weather icon bitmaps were created although only the first was displayed; large widgets allocate full pixel backgrounds | Exactly one weather glyph bitmap; glass image limited to 220k RGBA pixels |
| Local privacy/cleartext | App data backup enabled; no explicit HTTP cleartext policy | Disable automatic Android data backup and cleartext network traffic |
| Wind battery budget | Visually short 14px dashes; increasing particles would raise CPU use | Rounded quadratic strokes and <=32px trails without a new RAF/gradient allocation; existing particle count and data-saver behavior maintained |
| UI adaptation | Glass palette and text style were incorrectly coupled; native weather icons changed with dark/light text | Independent text Adaptive/White/Black control, colored glyphs based on weather condition; Qibla action shows progress and clear label |

## Android permissions

Declared: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`. These correspond to forecast/map networking, network-aware refresh and explicitly requested position/Qibla functionality. There are no declared background-location, contacts, camera, microphone, SMS, accessibility, overlay or storage permissions. No `PlaybackService` declaration/class exists in the inspected project tree; animation is performed in `FieldEngine` via a lifecycle-aware `requestAnimationFrame`, while compass sensors use `MainActivity.CompassBridge`. The platform/native plugin manifest merge must be checked in a final APK because dependencies can contribute permissions.

## DDoS and threat-model limits

Per-process concurrency and size limits reduce accidental or anonymous request amplification, but **cannot prevent a distributed attack**: enforce quotas/rate limits at CDN/WAF/reverse-proxy/host level; monitor outbound request counts; apply credentials/origin isolation and abuse detection where server functions are publicly deployed. A code review alone cannot prove the complete absence of spyware or deliberately hidden behavior; also review dependency provenance, binary APK and connected domains before public distribution.

## Android performance validation (device required)

Install the signed APK built from `main`, use the same test device and compare repeated conditions on Wi-Fi and mobile data:

1. Switch between home/map/settings 30 times; rotate screen; send app to background/foreground; change last city and system theme. Confirm compass sensor stops in background, weather tiles reload cleanly, no duplicate RAF or redraw.
2. `adb shell dumpsys meminfo net.nabdhserv.myweather` at start, after 10 minutes of wind, after 10 minutes of rain, and after 30 navigation cycles. Compare native heap, graphics, Java heap and total PSS. A sustained monotonic retained-heap climb after repeated cycles merits heap profiling.
3. `adb shell dumpsys batterystats --charged net.nabdhserv.myweather` after a controlled period. Compare foreground wind animation, rain frames, data-saver mode and background consumption with screen/brightness/network held constant.
4. Inspect `adb logcat` for `OutOfMemoryError`, `ANR`, WebView context loss, SSL errors and repeated HTTP 429. Use Android Studio Memory Profiler and Energy Profiler for allocation stack traces, not just aggregate PSS.
5. Verify widget on contrasting wallpapers: Adaptive text vs White/Black, cloud/sun/rain icon colors, widget resizing, refresh and dark/light system switches.

## Release gates

Require `npm ci`, fail-on-advisory `npm audit` (production + dev), TypeScript, UI/queuing/SSRF regressions, source contracts, Capacitor build/sync, Gradle unit tests and Android Lint. Existing Better Auth 1.7 external OAuth configuration/migrations still require explicit test if enabled on a live server; see `SECURITY_REVIEW_2026-11-11.md`. Do not claim dynamic penetration, battery, live OAuth or leak tests passed from CI alone.

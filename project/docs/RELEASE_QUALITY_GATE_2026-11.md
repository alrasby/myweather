# MyWeather Pro / طقسي — Unified adaptive design + scientific + release quality gate

**Review:** 2026-11-15 · **Signed device-QA candidate:** 1.0.0 (versionCode 58; signing must be proven by exact-head CI) · **Scope:** candidate branch stacked on `feature/material3-calm-glass-quality-audit-20261115` · **Production verdict:** **BLOCKED until measured device evidence and license approval**.

This is one engineering acceptance record, not a WMO/WCAG certification or a claim that the app has passed Google Play review. Keep the existing brand, Readex Pro, data and weather behavior. The design is **Material 3-inspired React/WebView**, not native Jetpack Compose.

## 1. Change isolation and invariants

- No changes to package ID `net.nabdhserv.myweather`, app labels, stored preference/cache keys, existing forecasts, alerts, Qibla, map models, Android Auto, widget, notifications, GPS, or navigation routes.
- Preserve saved/primary/preview city semantics, refresh, forecasts, settings, active tabs and weather-provider fallback. Test these via existing source and behavioral contracts.
- Styling uses tonal light/dark cards and modest glass only on small fixed navigation/tool surfaces. **No backdrop blur on opaque scrolling cards or the map canvas.** Motion-reduction preference disables stationary blur. Keep atmospheric visual and all approved weather layer palettes unchanged.
- Day/night focus-ring colors are chosen independently so the visible focus does not disappear on light backgrounds.
- Make independent source and time checks: the point forecast and ECMWF raster may be from different models; matching *UTC hour bucket* is not a license to combine their values as one observation.
- Day keys must use an explicit IANA time zone and `formatToParts`, never a browser-dependent localized date-string parse. Unit conversion runs on source values before display rounding. Stored source values remain unchanged.
- Draft PRs #88–#90 and tide pilots remain disabled/unmerged. Do not silently enable the off-device ECMWF gateway.

## 2. One automated QA command

From `project/`:

```bash
npm ci
npm run qa:release
npm run typecheck
npm run build:android
```

Android CI additionally runs the full existing forecast, map, source, security and UI regression suite, `./gradlew :app:testDebugUnitTest`, `./gradlew :app:lintDebug` and release identity validation. A passing unit test is **not** a measured touch target or verified visual contrast on the actual device.

| Acceptance axis | Automated contract | Required human/hardware proof | Current verdict |
|---|---|---|---|
| Visual identity, scrolling cards, nav and reduced motion | `design-quality.test.mjs` checks opaque-card no-blur, max 16 px remaining blur, M3 role pairs, focus and motion controls | Day/night AR/EN screenshots at 320/360/412/600 CSS px; compare full screen + scroll | **Pending CI + phone** |
| Contrast | Token-pair >=4.5:1 body; focus >=3:1; placeholders >=4.5:1 | Pixel/composited contrast audit, stateful controls, forced colors | **Static tokens only** |
| Touch and accessibility | 48 CSS px baseline, accessible labels, selected state, keyboard focus and RTL CSS guards | Measured hit areas, TalkBack flow, text scale 200%, right-to-left gesture/focus order | **Pending device** |
| Weather unit accuracy | `displayQuality.test.ts` checks C/F, km/h/m/s/mph/kn, hPa/inHg, m/km/mi | App UI labels and rounding, missing values, locales | **Pending CI + phone** |
| Times and data origin | `displayQuality.test.ts`, `mapForecastClock.test.ts`, `forecastSourceComparison.test.ts` | City time zone, midnight, daylight-saving, ECMWF valid hour and visibly credited provider | **Pending CI + phone** |
| Weather *forecast accuracy* | `forecastVerification.test.ts`: time/variable/unit/provenance match, Bias, MAE, RMSE, Brier score | Real independent observations + baselines, sample sizes and lead-time stratification | **No real scores** |
| Map visual + network integrity | Existing map render/cache/queue/run-id tests | Real Esri and ECMWF tiles Z3–Z6, antimeridian, Arctic, 20 pan/zoom cycles, gaps/tearing/first-complete-frame | **Pending device** |
| Low/mid Android performance | `device-qa-evidence.test.mjs` tests validator; optional evidence command below | Actual physical measurements for both tiers; record Android/WebView versions and video/profiler | **No physical evidence** |
| Licensing / distribution | Provider URLs exposed in settings/map; checked source references below | Owner authorization for services, appropriate contributor credit, commercial use and secure credentials | **Pending owner review** |

### Source-backed acceptance rules

- WCAG 2.2 AA text contrast **4.5:1** (except WCAG-defined exceptions), focus/non-text indicator target **3:1** where applicable. Project touch guideline **48 CSS px** for key controls; WCAG 2.2 2.5.8 minimum **24×24 CSS px**, subject to exceptions, is not itself a 48 px mandate.
- Screen-reader, text zoom, RTL and real on-screen contrast **cannot** be proved by CSS text matching alone.
- Avoid attributing the current point weather to ECMWF because the raster map happens to be showing ECMWF. Hour, run, point provider and raster provider remain independent.
- The verification score functions are **mathematics only** until independent, station-grade observations are loaded; no invented skill score.

## 3. Repeatable physical Android measurement

Test an **actual 2–4 GiB RAM Android** (low-tier) and **4–8 GiB RAM Android** (mid-tier) using release-like signed QA builds. Keep model, Android, WebView and app version in attachments. A browser's emulated slowdown is **not** physical-device proof.

1. Each tier: cold and warm starts, locale AR/EN + RTL/LTR, light/night, 200% font, keyboard/TalkBack, high-contrast and reduced-motion, switches and preferences; verify no clipping or inert 48 px targets.
2. City Muscat, Dubai, Mumbai, Helsinki, Hammerfest plus a Southern Hemisphere and date-line point. Verify selected city timezone vs device timezone, units, forecast provenance and no silent wrong-time weather.
3. On real ECMWF: Z3/Z4/Z5/Z6, 20 continuous pans/zoom/city/tab changes and 20 more navigation/city switches. Record p50/p95 end-to-end first **complete** viewport frame (not a partial tile), Esri black gaps, frame jank, cancellations, stale run and provider 429s. Test data saver, offline recovery and background/foreground.
4. Record UI interaction p95, cold start, JS heap **and Android native PSS**, with before/after 20 repeats. A JS heap chart is not a measure of all Android memory.
5. Capture screenshots, screen reader result, Chrome Remote WebView/Android Studio profiler trace, build head SHA, timestamps, device details. Keep all evidence with the PR review.

Release **provisional budgets** checked by `device-qa-evidence.mjs`: low-tier UI p95 ≤160 ms / cold start ≤5500 ms; mid-tier ≤100 ms / ≤3500 ms; both ≤32 MiB sustained JS heap growth and ≤96 MiB native PSS growth after repeat navigation; zero crashes, black map gaps, unclipped controls and all accessibility/source/time checks pass. Real ECMWF first-complete-frame p95 must be **reported**, but the gate does not fabricate a global latency ceiling before real measurement. Reassess thresholds using real devices only and record changes in the PR.

This command **fails** when either profile is missing or checks fail; passing synthetic unit fixtures only proves the validator, never the app's performance:

```bash
cd project
node scripts/device-qa-evidence.mjs /path/to/real-device-evidence.json
```

JSON schema: `{ "runs": [ { "tier": "low", "source": "physical-android", "device": "...", "testedAt": "ISO-8601", "ramGiB": 3, "uiInteractionP95Ms": number, "coldStartMs": number, "mapFirstFrameP95Ms": number, "jsHeapGrowthMiB": number, "nativePssGrowthMiB": number, "crashes": 0, "rtlArPass": true, "ltrEnPass": true, "textScale200Pass": true, "touchPass": true, "screenReaderPass": true, "reducedMotionPass": true, "unitsPass": true, "timeZonePass": true, "sourceAttributionPass": true, "noClippingPass": true, "noBlackMapGapsPass": true }, { "tier": "mid", "...": "same fields with real observations" } ] }`. Attach separate raw artifacts; this file is a signed-off test summary, not cryptographically verified measurement.

## 4. Licensing / provider compliance — review against current official documents

| Provider | Current project usage | Owner must verify before distribution |
|---|---|---|
| Open-Meteo | Point best-match, location and map-source data | Free hosted API is limited to qualifying **non-commercial** usage and call caps; CC BY 4.0 for data is **not** commercial authorization for that free hosted API. Verify app monetization, endpoints, usage rights, modification notice and attribution; upgrade or self-host only after separate evaluation. https://open-meteo.com/en/terms · https://open-meteo.com/en/license |
| ECMWF | IFS-derived cloud/rain/snow through Open-Meteo-hosted files | ECMWF's **open-data subset** is CC BY 4.0 with attribution and terms; this does not automatically authorize every ECMWF feed or third-party hosted gateway. Preserve real source, run/valid time, modifications and redistributor terms. https://www.ecmwf.int/en/forecasts/datasets/open-data · https://apps.ecmwf.int/datasets/licences/general/ |
| MET Norway | Point-forecast fallback | Identify application/contact in User-Agent or Origin as applicable, avoid unnecessary calls, respect 429, credit MET Norway, disclose changes, verify native/proxy headers. Terms revised Nov 5, 2026. https://docs.api.met.no/doc/TermsOfService.html · https://docs.api.met.no/doc/License.html |
| Esri World Imagery | Raster satellite basemap | Esri-only static credit is **not enough to close audit**: verify actual imagery layer REST access/terms/authentication, dynamic Esri/Maxar/Earthstar/GIS User Community and local contributor attribution where applicable, billing exposure and labels. Do not add unapproved paid basemap service. https://doc.arcgis.com/en/data-appliance/latest/imagery-elevation/world-imagery.htm · https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/ |
| Tide/marine/cyclone sources | Pilots and optional fields | Track model-by-model license, station datum, quality and geography. PyFES/FES2022 Atlas cells not deployed by default; no marine-navigation safety claim. |

Visible attributions must not replace service permission. Log owner sign-off in the PR; do not hide source credits to make the interface look cleaner.

## 5. Final release decision

The **same review** requires: (1) exact-head CI all green, (2) screenshot/TalkBack/touch evidence, (3) both device tiers measured and evidence validator passing, (4) actual weather/time/source samples, (5) source/license owner approval, (6) a unique upgrade-safe Android version code and correct signing identity, (7) no user-visible regression. A CI pass alone only changes automated tests from *pending* to *passed*; remaining gates stay blocked.

**As of this source review:** new tests and design corrections are committed on an isolated branch; **physical test evidence, independent forecast accuracy observations, and final commercial API sign-off are absent**. Do not merge into `main` or proclaim WCAG/WMO certification.


### Build 63 / PR #93 — release-blocking resource audit

- Exact-head CI must pass TypeScript, source contracts, native request lifetime, ECMWF dataset flight cancellation, scoped provider URL validation, Gradle, Android Lint and original APK signing.

- Recheck on two physical Android tiers: measured cold-start first **complete** ECMWF layer, readP95, native queue P95, worker data copies/joins, heap + native PSS after 20 city/map/tab cycles, idle battery drain and background/foreground. A synthetic test or simulated Android frame does not constitute evidence.

- The hosted geocoder URL is opt-in at build time. Shipping without provisioned service leaves Open-Meteo and offline local search working; never use the shared public Photon instance as a hidden production fallback.

- No unrelated source-module removal from a staged React/Capacitor application without an import/behavior/CI proof. The legacy backup branches and tests are preserved for compatibility; clean the hot paths first, not user-approved app features.

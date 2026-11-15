# MyWeather / طقسي — Design + Weather Quality Review

**Review date:** 2026-11-15  
**Scope:** Android WebView (React + Capacitor) based on signed **1.0.0 (57)**; design candidate **1.0.0 (58)**.  
**Release status:** independent draft PR; **not a certificate of WMO, WCAG or Google Play approval**.

## 1. Architecture and invariants

- Material Design 3 **inspired** color roles and tonal surfaces; not a native Jetpack Compose implementation.
- Calm Siri-inspired glass: lightweight, static <=16px blur on *small stationary components only*. No animated backdrop blur, full-window screenshot overlay, new map tiles or DOM image cloning.
- Same Readex Pro font, existing brand colors, sky, line charts, cards, feature order and city/weather data. No new data providers, AI model, paid tile service or map-engine change.
- Day/night tokens are scoped to `html.light` and default night. High contrast removes blur; reduced motion removes decoration; focus-visible outlines are not suppressed.
- Search, saved-city reorder/delete/primary/preview, home refresh, weather units, alert settings, bottom tabs and map remain the same data/behavior functions.
- Accessibility: primary touch targets >=48 CSS pixels in nav, cities, settings, search; the stricter project guideline exceeds WCAG 2.2 AA 24x24 minimum target criterion. Small legal links may use >=24 CSS pixels and have spacing.

## 2. Automated checks vs actual proof

| Criterion | Implemented evidence | Status |
|---|---|---|
| Day/night primary, secondary and search contrast >=4.5:1 | `scripts/design-quality.test.mjs`, static design-pair checks | **Automated token check**; not a screen-wide pixel audit |
| RTL + localization | `root.lang`/`root.dir`, RTL switch direction and AR/EN source descriptions | Source verified; needs device/TalkBack test |
| 48px targets and keyboard focus | `wx-bottom-nav`, `wx-city-action`, settings chips/switch; `:focus-visible` | Static source check; needs measured bounds on device |
| High-contrast and reduced-motion | CSS media queries and animation guard | Static check; needs Android runtime validation |
| Current-hour and model-run integrity | `mapForecastClock.test.ts`, source-pinned ECMWF snapshot logic | Unit tested; not a meteorological accuracy certificate |
| Units, local timezone, forecast source difference | Existing `format.ts`, `forecastSourceComparison`; new source-contract tests | Unit/source checks; need API fixtures for representative timezones |
| Forecast verification: bias, MAE, RMSE, Brier | `forecastVerification.ts` + independent test fixture | **Implemented math only**; no real observed-score results |
| Map imagery and attribution | Always-visible map-source pill and settings official license links | Basic attribution in app; **dynamic Esri contributor audit still required** |
| Heavy-map performance | No map render/cache/worker changes; static max-blur gate | **No physical low/mid hardware benchmark yet** |
| Regression testing | Existing map/source/renderer/weather unit suite, TypeScript, Android Lint, signed CI | CI build proof only, not hardware visual acceptance |

## 3. Sources and licensing — checked against provider pages

| Provider | Actual use in app | Licensing / action |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/en/terms) | best_match point forecasts, air quality, search and some fallback map data | CC BY 4.0 attribution with indication of conversions/aggregations; **free API restricted to qualifying non-commercial use**; assess commercial distribution and call-volume/credentials with owner |
| [MET Norway](https://docs.api.met.no/doc/TermsOfService.html) | point-forecast fallback | Explicit contact site in `User-Agent` and source credit; provider requires identifying UA, appropriate traffic and source attribution. Verify headers survive the app proxy/native HTTP stack |
| [ECMWF](https://www.ecmwf.int/) | spatial cloud/rain/snow forecast via Open-Meteo hosted source | Cite model/provider accurately, preserve valid time/model run; confirm upstream ECMWF and derived redistribution conditions before commercial launch |
| [Esri](https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/introduction-basemap-styles-service/) | World Imagery base map | Always-visible © Esri link added. **Provider/contributor-specific credit, service authentication/access and terms still need owner review** |
| Other cyclone and marine sources | GDACS, JMA, modelled marine/tide input | Ensure attribution/terms per feed; tide forecasts remain estimates and must not be used for navigation |

The service restrictions for the public APIs are distinct from rights granted under a *data* license. Showing attribution does not independently authorize commercial use of a restricted API service.

## 4. Scientific verification gate (WMO-aligned, NOT WMO-certified)

The QA engine scores independent matched forecast-observation pairs with the **same variable, unit and UTC valid time**, excluding mismatches. `bias`, `MAE` and `RMSE` are calculated for deterministic values; **Brier score** is available for probability forecasts normalized to [0..1]. No observed records have been imported in this project yet, so real forecast accuracy is **unknown**.

To begin real verification, collect station observations with identifiable provenance for Muscat, Dubai, Mumbai, Helsinki and Hammerfest; preserve issue time, valid time, timezone, forecast provider/model, unit and lead time. Separate temperature/wind/rain data and lead-time buckets (0-24h, 24-72h, 3-7d, 8-15d). Report missing cases, sample sizes, confidence intervals and reference baselines. Do **not** compare 05:00 point observations with a 13:00 ECMWF map. Do **not** derive hourly rainfall by duplicating 6h/12h accumulations or call a forecast current observation.

WMO guidance and internationally used scores provide **methodological alignment**, not formal accreditation. Source reference: [WMO WIPPS guidance](https://wmo.int/) and [JMA score definitions](https://www.jma.go.jp/jma/jma-eng/jma-center/nwp/outline-latest-nwp/pdf/outline2026_Appendix_A.pdf).

## 5. Hardware and visual acceptance before public release

**Not yet run on the following physical hardware (required):**

| Device tier | Proposed test class | Required cases |
|---|---|---|
| Lower-end | Android WebView with ~3GB RAM / entry-level GPU | AR/EN and RTL, light/dark, city search, opening settings, 200% text size, TalkBack, slow/offline network, battery/data saver, map Z3–Z6 |
| Mid-range | Android WebView with ~6GB RAM / mainstream GPU | Same scenarios, plus pinch/pan repetition, 15-day forecast, switching cities, returning from settings, background/foreground |
| Accessibility | Screen reader + keyboard/large text/high contrast | Focus order, toggles, legends, charts, 48px interaction areas and source links |

**Proposed monitoring targets, not measured acceptance:** no critical clipping or overlap at 320/360/412/600 CSS px widths, no blocked weather/city actions, no white/black map rectangle from UI blur, 95th-percentile UI interaction under 100ms on mid-tier, and no sustained increase in WebView JS heap after 20 repeated tab/city changes. Measure cold/warm startup and map load separately. Existing ECMWF long-tail source reads may exceed seconds; this design PR must not be credited as solving them.

Use Android Studio profiler or Chrome remote WebView inspection and capture frame time, JS heap **and** native/GPU footprint. JS `heapUsedMb` alone is NOT total Android memory. If any static blur makes scrolling jank on low-end hardware, use `backdrop-filter:none` plus solid tonal fill for that device tier without changing data.

## 6. Acceptance and release decision

1. GitHub Android CI green **on this exact design branch head** with new source tests, unit tests, TypeScript, Android lint, signature verification.
2. A/B screenshot tests on light/dark, AR/EN and narrow/large-screen devices; verify no content, settings or weather values were lost.
3. Manual TalkBack, touch bounds and reduced-motion checks.
4. Commercial API terms and imagery attribution/provider credits reviewed by authorized owner.
5. Real forecast skill numbers reported only when independent observations are available.
6. Physical visual stability at Z3–Z6 confirmed separately for PR #90 basemap and ECMWF.
7. No merge of either draft PR until these release gates are satisfied.

**This document is an engineering QA record, not a marketing claim of full international standards compliance.**

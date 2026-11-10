# MyWeather Pro — ECMWF rain, snow and cloud pipeline review

Date: 2026-11-10. Scope: **spatial clouds, precipitation and snowfall only**.
Wind, temperature, homepage, location and sunrise/sunset are out of scope.

## Verified architecture
`MapScreen -> FieldEngine (timeline) -> ModelField.sync / pump -> Leaflet GridLayer
 -> @openmeteo/weather-map-layer omProtocol (worker + WASM)
 -> window.fetch patch -> CapacitorHttp Range reads from S3 -> OM decode -> raster tile -> Leaflet paint`.

The three spatial layers (`cloud_cover`, `precipitation`,
`snowfall_water_equivalent`) share a model valid time. The last complete
spatial frame is held during an incomplete download. `ModelFrameQueue`
allows one incomplete model hour at a time and prefetches the next hour.
On unrecoverable failure a global point-based Open-Meteo forecast is drawn.
Do **not** expose incomplete layer sets with different timestamps.

## Confirmed architectural costs and changes in this PR

1. **Capture API resolution overhead**: the previous `om://...latest.json`
   URLs cause the external protocol to resolve metadata repeatedly.
   The library documentation estimates **0.5–1 second per capture request**.
   The app already downloads `latest.json` once. The new URL builder pins
   the run and addresses the actual per-valid-time `.om` file directly,
   using the model reference timestamp as the folder and each valid timestamp
   as the filename. Precipitation accumulation interval is passed explicitly.
   If direct-file retrieval fails, fall back once to the compatible Capture
   API for that app session (without an infinite loop).
2. **Expired model runs**: S3 metadata may lag or have expired. It was possible
   to show a days-old model under a future slider date. Reject incomplete,
   expired or more-than-48-hour-old ECMWF runs, and instead use a time-matched
   fallback with a clear diagnostic reason.
3. **Worker transfer/decoding**: Open-Meteo documents a costly copy of entire
   weather variables to the raster workers without cross-origin isolation.
   Android WebView's `crossOriginIsolated` is now reported to confirm this
   hypothesis on the target phone. Enabling COOP/COEP in a Capacitor WebView
   is intentionally NOT done without proving cross-origin map tiles and worker
   assets will continue to load.
4. **Rendering overhead**: PR #57 already stopped DOM layer reordering on
   every opacity-interpolation tick. This PR instruments `omProtocol`
   end-to-end tile production and Leaflet tile-delivery latency, in addition
   to native request queue wait and native HTTP execution durations.
   Metrics are bounded (last 128 samples for p95); no URL, location or user
   identifier is collected. `workerTile` includes network, transfer, decode
   and raster render; it **cannot** be called CPU decode-only. On-device
   Chrome tracing / worker instrumentation is required to isolate exact CPU
   decode milliseconds.
5. **Timeline**: keep one requested incomplete frame and preload the adjacent
   hour; require the requested model hour before advancing spatial playback.
   The user sees an explicit buffering state rather than an incorrect
   timestamp or frozen old imagery labelled as current. The new direct
   resource path removes repeated metadata work before altering concurrency
   or memory budgets again.

## Cloud visual-source assessment

`cloud_cover` is a **forecast fractional coverage field** (0–100%), not
a rendered visible-light satellite image. Linear interpolation and a white
opacity palette can depict broad forecast cloud areas, but cannot reconstruct
the fine fractal edges, texture and optical depth of actual satellite cloud
photographs. Reducing opacity / shaping the palette will not fix that.
Switching to satellite imagery also changes semantics: most satellite
products are **observations of the recent past**, not future predictions.
A future-weather animation cannot silently substitute current satellite
pixels for forecast hours. A separate licensed satellite observational
layer could be offered later, **only after verifying provider rights,
temporal coverage, request quotas, and Android performance**. This PR
does not invent or embed an unverified satellite URL.

## Reproducible Android acceptance matrix (NOT satisfied by CI alone)

Use the signed Android APK generated from the merged main commit, with
diagnostics `ⓘ` open. Test once on Wi-Fi and once on cellular. Run both
cold cache and second-pass warm cache. Keep the user-visible map extent
and device constant across comparisons.

| Scenario | Acceptance condition |
|---|---|
| Cold open, high cloud region | Correct valid time and source, initial layer reaches `loaded` or explicit fallback error; no silent stale forecast |
| 60 seconds of playback | Requested and displayed valid times agree once ready; no stale spatial hour labelled as new |
| Continuous map pan 30 seconds | Latest viewport fills without persistent rectangular holes; no runaway pending frames |
| Zoom 3 → 8 → 3 | No persistent tile gaps, no crashes; pending tile count stabilizes |
| Time seek + reverse seek | Previously loaded hour can be revisited; no stale layer mislabeled |
| Offline/timeout then return online | Bounded retry; fallback visibly identified; recovery without reinstall |
| Cold vs warm read | Observe `nativeQueue`, `network`, `workerTile` and `leafletTile` p95 and cache hits |
| Memory/background | No unbounded frame/timer accumulation; exit/re-enter the map without memory crash |
| UI quality | Wind/temperature and homepage unchanged; clouds are not advertised as satellite observations |

**Performance targets (device acceptance, not measured claims)**:
network queue p95 < 1000ms in a warm run, tile protocol p95 < 3000ms,
no individual buffering episode > 8 seconds with an otherwise healthy
source, no recurring `ECMWF tile readiness timeout` after repeated
warm viewing. If these fail, use diagnostic p95 and shared-memory result
to decide whether the renderer/worker or network needs replacement.

## Evidence limitations
GitHub CI validates TypeScript, pure run-path/freshness/profiling tests,
source contracts and Android build/tests. CI cannot emulate real ECMWF
S3 latency, Android WebView `SharedArrayBuffer` support, device GPU
compositing or the quality of true evolving cloud patterns. These
criteria must be confirmed on the physical test device. No claim of a
"final visual fix" is justified by passing CI alone.

## External technical references
- https://github.com/open-meteo/weather-map-layer/blob/main/README.md
- https://github.com/open-meteo/open-data

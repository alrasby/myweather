# ECMWF weather layers: architectural performance review (2026-11-11)

Scope: **cloud cover, precipitation and snowfall only**. Home weather, sunrise/sunset,
wind and temperature are deliberately excluded.

## Evidence: Android screen recording at 07:35, 11 November

The 83.5-second device recording shows an active rain/snow timeline, repeated
weather shapes during time changes, and intermittent waiting. The weather
diagnostic overlay reports approximately:

| Component | p50 | p95 |
|---|---:|---:|
| Native HTTP queue wait | 0 ms | 758 ms |
| Native HTTP transfer | 360 ms | 466 ms |
| Cloud tile *total pipeline* | 6,705 ms | 9,501 ms |
| Rain tile *total pipeline* | 4,063 ms | 6,794 ms |
| Snow tile *total pipeline* | 2,299 ms | 4,224 ms |

These are samples from this device, **not** a controlled benchmark; tile
pipeline time includes reading, decoding, worker messaging and rendering.
It is **not** a direct measurement of the WASM decoder alone.
The recorded page reports `SharedArrayBuffer: unavailable`, 133 MB of
JavaScript heap, and 29 counted native failures (some may be cancellations).
The former displayed `MB` count could include `HEAD` resource lengths rather
than bytes transferred. It must not be interpreted as resident memory.

## Verified processing path

1. `MapScreen` plays a rain/snow forecast clock; `ModelField` selects an
   ECMWF model-valid-time index, with bounded next-hour prefetch.
2. Three Leaflet `GridLayer` instances request on-screen tiles at the same
   forecast time: `cloud_cover`, `precipitation`,
   `snowfall_water_equivalent`.
3. Each layer calls `@openmeteo/weather-map-layer`'s `omProtocol`, which reads
   S3 `.om` byte ranges and draws tiles using workers + WebAssembly.
4. Android uses `CapacitorHttp` for model-file range requests, bounded by
   `SpatialNativeQueue`, and caches completed ranges in
   `SpatialRangeCache`.
5. Full-frame readiness requires all three tile queues. This is intentional:
   advancing the clock and showing a mixture of old/new weather data would be
   misleading. Fallback is time-matched when ECMWF cannot be shown.

## Primary bottleneck and platform constraint

The observed network p50 is far below the full tile pipeline p50. The dominant
remaining cost is therefore the post-network tile preparation path, not just
bandwidth. Open-Meteo documents that without cross-origin isolation and
`SharedArrayBuffer`, worker tile rendering may copy the decoded weather field
for each tile, slowing pan/zoom. This is consistent with this Android WebView
measurement. The package itself warns it is not fully production ready.

Do not add unsafe WebView origin overrides or disable browser protections to
manufacture `SharedArrayBuffer`. Correct isolation involves COOP/COEP and
compatible resources; Android WebView support must be validated separately.

## This PR: bounded low-risk reductions

- Coalesce **concurrent identical OM byte-range reads** before the completed
  cache becomes available. Consumers have independent abort signals; after the
  last abort the waiting native work is skipped.
- Avoid starting a separate detailed Open-Meteo regional/global fallback grid
  when complete ECMWF spatial imagery is already on screen. Retain the
  lightweight fallback already loaded; request detail again if ECMWF becomes
  unavailable. This removes competing pointwise data-processing work while
  the model workers render their tiles.
- Keep the existing single-incomplete-forecast cap, pinned model run,
  per-hour timestamps and source-integrity rules.
- Correct diagnostics: `HEAD` Content-Length is not transferred bytes, and
  viewer-canceled requests are not upstream failures. Add single-flight join
  counts, real payload totals and cancellation counters.
- Test concurrency, cancellation, retries and payload accounting independently.

The above reduces redundant network work but **does not** make all OM worker
decoding/rasterization cost disappear. No unsupported claims of Windy-equivalent
performance are made.

## Long-term rendering decision

For near-instant multi-hour animation on Android, the most promising
architecture is to **pre-render and cache immutable forecast image tiles**
(PNG/WebP) server-side, indexed by *model run + valid time + variable +
zoom/x/y*. The Android client would then fetch small already-rendered raster
tiles rather than transferring and decoding global OM data into WebView workers.
Validate data licensing, backend cost, forecast refresh, no stale-hour blending,
cache versioning and geographically consistent tile edges before migrating.

Alternative: a licensed third-party pre-rendered forecast imagery API with
cloud/precip/snow coverage and supported forecast hours. These alternatives
are **not implemented** here and must not be represented as available endpoints.

Cloud cover from ECMWF is a **numerical forecast percentage**, not a satellite
cloud photograph. It cannot reproduce natural photographic cloud texture by
changing opacity or interpolation alone.

## Acceptance criteria for future device builds

- Actual displayed ECMWF valid time equals selected time, or explicitly show
  waiting/time-matched fallback; never silently show an old frame.
- No rectilinear blank tile holes after coverage has settled.
- Cloud/rain/snow tile p50/p95 plus network, cancellation and join counters are
  recorded under matching phone, viewport and forecast conditions.
- Target (not measured): p50 complete cloud tile <= 1 second, p95 <= 2 seconds,
  normal forecast-hour transitions with <= 1 second visible wait.
- Bound memory and active native requests; test continuous pan, time playback,
  rapid seek, network loss and model-run rollover.
- Do not change wind/temperature to satisfy these targets.

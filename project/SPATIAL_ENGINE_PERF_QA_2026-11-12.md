# MyWeather spatial engine — measured optimization / pre-merge gate

## Branch scope
Stacked on unfinished PR #78 (Android Auto, interactive sky, cards). No changes to
mobile design, official weather model color ramps, map imagery/leaflet geometry,
wind/heat layer, versionName `1.0.0`, versionCode or base forecast providers.
Do not merge this branch independently of its base.

## Inspected end-to-end pipeline
1. **Metadata:** ECMWF `latest.json` supplies run reference time, available
   variables and valid hours. `pinSpatialRun` pins a single model run.
2. **Network:** `installSpatialFetch` intercepts model .om HTTP and preserves
   Range semantics using CapacitorHttp on Android. Concurrent identical byte
   ranges share one in-flight request (`SpatialRangeFlights`); completed 206
   ranges use byte-bounded 12 MiB/5 min `SpatialRangeCache`.
3. **Native queue:** `SpatialNativeQueue(6)` limits nonabortable native work.
   Cancellation skips queued requests and discards late results. Do **not**
   raise to improve benchmarks without device evidence and provider consent.
4. **WASM/worker:** Open-Meteo Weather Map Layer `0.3.x` owns .om
   decoding and raster tile rendering. `updateCurrentBounds` limits decode
   to the padded viewport; the library performs tile-grid snapping.
   `crossOriginIsolated=false` can require bulk worker copies; configuring
   cross-origin isolation for Capacitor requires separate platform verification.
5. **Tile readiness:** requested hour first; subsequent hour on idle/playback;
   a second lookahead only while playback is active and both earlier hours
   are complete. Cloud preview may appear before rain/snow, but full
   foreground replacement requires all 3 source-backed layers.
6. **Presentation:** Keep prior ready ECMWF frame during refresh; fade only
   between actual valid frames and synchronize displayed/requested timestamps
   in the existing hidden diagnostic panel. No fake rain/snow imagery.
7. **Existing fallback:** Open-Meteo grid only on real model misses; selective
   4.5-second fallback grace. Do not run simultaneous global+regional grids
   when ECMWF fully covers the viewport.

## Changes in this branch
- 429 (or 503 with Retry-After): bounded backoff respecting server hint.
  Suppress browser fallback for these statuses; cached verified ranges still
  serve while network is blocked. Do not retry in a tight loop or raise native
  HTTP concurrency. Expose incident count and remaining cooldown.
- Coalesce simultaneous 0–0 size probes for the same .om file. Unrelated probes
  retain normal parallel queue operation; abort is per consumer.
- Track time-to-metadata, time-to-first *ready* cloud layer and first complete
  ECMWF cloud/rain/snow frame from attach. These are not pixel-visible timings;
  true isolated WASM decode time is unavailable without upstream worker hooks.
- Prevent use of the estimated bootstrap global grid for the rain renderer
  when no source-backed rainfall is available.
- Existing hidden diagnostic panel can copy a bounded real-device report
  including network queue p50/p95, transfer bytes, tile end-to-end p50/p95,
  429 incidents, startup milestones, and available WebView heap estimate.
  No API keys or location coordinates are included.

## MapTiler Weather experiment — restricted, not an active raster provider
- Opt-in **catalog-only** check in existing hidden diagnostic panel. Uses
  documented `/weather/latest.json` and a restricted public test key entered
  temporarily, never persisted or sent to GitHub. The checked response lists
  actual variables and keyframe times, no guessed raster endpoints.
- No MapTiler SDK bundle or network requests unless the user explicitly runs
  the probe; no automatic fallback to MapTiler or replacement of ECMWF.
- A visible MapTiler weather layer must be implemented using a supported
  SDK and assessed for WebGL/map resource usage, license and session quotas
  before Play deployment. Do not advertise it as already integrated.
- MapTiler Free is described as non-commercial/R&D and usage-limited;
  a free-to-download app is **not** automatically qualified. Obtain confirmed
  terms for public Google Play use, use a restricted key, retain attribution.

References:
- https://github.com/open-meteo/weather-map-layer/blob/main/README.md
- https://docs.maptiler.com/sdk-js/modules/weather/
- https://docs.maptiler.com/cloud/api/weather/
- https://www.maptiler.com/terms/cloud/

## Repeatable Android QA (capture same device/network)
With fresh app session, record before/after from the existing diagnostics:
- Muscat (rain), London (cloud/precip), Hammerfest/northern Russia (snow),
  zoom/pan and +180/-180 wrap. Cold launch vs warm cache separately.
- First-ready cloud, first-complete 3-layer frame, network wait/transfer,
  native bytes and 429 counts, tile pipeline p50/p95, heap when available.
- Weather radar/rain ≠ snowfall equivalent; do not show terrestrial snow cover
  as falling snow. Dry transparent tiles are valid dry forecasts.
- Validate actual hourly labels, map scrubbing, frame hold during provider
  outages, no rectangles/lines after panning, zoom and dateline.
- Test under connectivity change, background/resume and data-saver mode.
- Do not claim speedup until before/after device measurements establish one.

## Release gate
CI TypeScript, deterministic unit tests including rate policy and MapTiler
catalog parsing, web sync, Gradle unit tests/Lint and signed build must pass.
Do not merge until mobile field tests and real 429/datetime responses pass.

# MyWeather ready ECMWF tile service — isolated QA prototype

This is an **off-device source-backed PNG forecast pipeline**. It has NOT been verified against live ECMWF .om in a real hosted Chromium session or on physical Android. It is intentionally not activated in the shipping application.

## Linux host

From project/ run:

1. npm ci
2. npx vite build --config forecast-tiles/vite.config.ts
3. npx playwright install --with-deps chromium
4. TILE_CACHE_DIR=/var/cache/myweather-tiles node forecast-tiles/server.mjs

Service binds to localhost:8788. Reverse-proxy ONLY /v1/ through HTTPS; never expose /__render/. Apply public rate limits and a disk capacity cap.

- GET /v1/manifest.json — current pinned model run, UTC times and variables
- GET /v1/tiles/{runId}/{timeIndex}/{layer}/{z}/{x}/{y}.png — immutable source-backed PNG
- GET /v1/health — cache counters

Chromium runs the original Open-Meteo .om decoder off the phone. One page serializes render requests. The 2-slot bounded gateway deduplicates, validates and caches PNG; it rejects arbitrary model URLs, invalid time/layer coordinates and artificial images.

## Required acceptance gates

Verify a live ECMWF run, precipitation rate normalization, full dry/transparent images, seams, dateline/high-latitude behavior, model-run rollover, provider throttling, browser crash recovery, p50/p95 cold and warm latency, storage and network costs, licensing and attribution. Do not switch on Android or merge without real-device proof. For production volume, deploy persistent cache and CDN or object storage with prewarming.

AI is a bounded demand predictor for **real image URL priority** only. It never generates fictitious weather patterns, clouds or high-resolution forecast values.

## Lightweight on-device intelligence (prototype)
A 30-weight, six-outcome online softmax classifier in `src/weather/tinyTileDemandModel.ts` learns relative gesture/forecast-hour demand in memory. It abstains until 16 observations, has bounded work and weight magnitudes, and is reset on teardown. It does not store user locations, send analytics, call any AI API, alter forecast values, or draw invented pixels. The deterministic prefetch remains the fallback; **better cache hit rate is a hypothesis requiring A/B device measurement**. A dedicated 2x2/4x4 geographic metatile groups neighboring off-device renders into shared upstream data windows; the original raster interpolation and palettes are unchanged. No Neural Super Resolution or optical flow is used, because those could create misleading atmospheric features.

## Real visual improvements (QA)

- Pairwise opacity cross-fade is scheduled only when **both adjacent complete ECMWF hours** exist, with a reduced-motion bypass. Large timeline jumps replace atomically, not by blending physically unrelated times.
- The headless renderer serves its local script entry with COOP/COEP headers to permit SharedArrayBuffer between **server-side** Open-Meteo workers when its upstream resources support CORS. Disable with `TILE_RENDER_ISOLATION=0` if a source fails isolation checks.
- A complete PNG validator checks chunks, dimensions, CRC and bounded decoded image data before immutable caching; invalid provider responses fail closed. Rendering uses geographic 4x4/2x2 metatiles.
- Cache hits/render p95 are exposed by the prototype health endpoint; on-device model has only ephemeral weights and never affects meteorological image pixels.
- Cross-fades, seams, simulated failures, and real observed Android frame rates still require visual QA. No machine-learned super-resolution, fake precipitation or synthetic cloud texture is permitted.

## Verified live raster QA (13 November 2026)

GitHub Actions [live run #43441484552](https://github.com/alrasby/myweather/actions/runs/43441484552) on commit `ad305914` **passed**: Chromium rendered all three genuine ECMWF variables for one NYC tile (z8/x75/y96) from the pinned 2026-11-13T06:00Z model run, valid at 09:00Z. Cold generation: cloud 1378 ms, precipitation 704 ms, snow 220 ms; cached cloud retrieval 2 ms (single sample, not a phone/device benchmark). Three PNG samples and JSON metrics are preserved in the workflow artifact. All are 256x256 and validate as complete raster files. Client device rendering/smoothness, adjacent tile seams, real deployment and high-latitude QA are **not yet proved**.

The gateway also retains the **last verified previous model run** for a bounded grace period during metadata rollover (default 6 hours). Brief upstream metadata failures reuse only the last verified run (default 10-minute stale limit), rather than creating forecast values or immediately breaking active sessions. These fallback paths are independently regression-tested.

## Experimental Android integration — deliberate opt-in (not released)

The Android/map UI remains unchanged by default. The new `ReadyTileModel` delegates to the existing `ModelField` unless an explicit diagnostic opt-in and a safe HTTPS service origin exist. It first probes the strict pinned-run manifest with a 5-second deadline; failed probes, invalid or stale metadata and failed image tiles revert automatically to the original source-backed engine for the entire map session. Both engines do not decode/run at once. Map teardown cancels the pilot and clears image requests.

Only testers with a privately deployed, authenticated-and-rate-limited HTTPS `/v1/` reverse proxy should set these localStorage keys in the app's WebView debugging environment (not on production devices):
- `myweather.readyTiles.enabled = "1"`
- `myweather.readyTiles.origin = "https://tiles.your-approved-host.example"`

Do **not** use an arbitrary public tile host or an HTTP address. A full app restart/map remount is required after toggling the pilot. This intentionally does not add a user-facing setting or make a network request on normal installs. Public deployment, load testing, tile/temporal parity and physical Android acceptance still block release.

## Android visual rollback after observed regression — 13 Nov 2026

The first experimental fullViewportRefresh/14-second visual barrier was rolled back after device diagnostics showed a 32.8s first complete ECMWF frame, 3.87s worker queue p95 and 215MB heap. The original source-backed local ECMWF renderer, existing small-pan staging and safe fallback path were restored from the last previously successful version. For non-isolated Android worker-cache rendering the scheduler now disables speculative **second-next-hour** decoding, while retaining the immediately following hour. When playback is explicitly started, one real source-backed rain-world fallback request is permitted early to avoid a repeated stalled forecast boundary. The stronger loading warning is reserved for sustained waits (18s), not routine 8-second source decode. These changes are mitigation candidates, not measured FPS or proof of visual smoothness; repeat a real-device pan/time/zoom test before merging. Remote ready-tile + on-device 30-weight predictor remain isolated and disabled by default until a real HTTPS host is deployed.

## Decoded-grid identity root-cause fix (2026-11-13)
The local worker renderer received request-scoped shallow state snapshots from upstream postReadCallback. The old WeakMap keyed on state wrapper identity, meaning two wrappers could trigger repeated 25MiB worker clones and evictions even while sharing the exact decoded Float32Array. Worker registrations now use the source-owned immutable data reference plus a signature of model file, variable, geographic ranges/grid, scale and palette. The previous full-viewport gating rollback is preserved. This targets unnecessary worker copies; it does not remove full .om decode latency or prove better real-device P95. Android memory, actual cache reuse, and map smoothness must be remeasured with the same workload before accepting it.

## Global coastal eligibility with real shoreline geography (November 2026)

The app now builds a compact local latitude-indexed coastline binary from *pinned* Natural Earth 1:10m ocean coastlines and minor islands (CC0 license; source commit 0b9a6ceb0a7032713abd9460ac1e995a9c60cd1e). Shoreline classification is independent of the much coarser ~8km Open-Meteo sea-level model cell, which could snap Muscat 22.66 km offshore and falsely call it inland. A city qualifies within 12 km of this real global shore and only if the genuine Marine model cell is at most 55 km offshore and provides valid values. Neither proximity is a claim that the model yields calibrated port tides. The bundled ~10m Natural Earth cartographic scale is *not* 10-meter positional accuracy; dynamic estuaries, small islands and local sea walls can differ. No remote coastline lookup or city-name allowlist at runtime. Missing/coastline corruption fails closed. A new marineVersion=3 migrates old cached city classifications. The live QA checks Muscat, Dubai, Mumbai, Helsinki, Hammerfest and inland Riyadh/Prague. 

A globally accurate port-tide product requires a more precise licensed astronomical tide model (e.g., FES2022b from AVISO/CNES, 1/30 degree plus relevant refined coastal datasets) validated against local tide gauges and chart datums. This project has NOT acquired/embedded FES2022 or proved navigation-grade local accuracy. Keep the honest mean-sea-level / not-for-navigation disclaimer for Open-Meteo Marine. Do not merge this without verifying the pinned-build artifact and actual coastline city tests.

## Off-device safety hardening (14 November 2026, QA only)

The renderer still uses the **exact source-backed ECMWF IFS .om data and
matching existing RAIN / SNOW / CLOUD breakpoints**. No weather values,
forecast hours, imagery styles or normal Android map settings are changed.
The optional ready-tile origin remains OFF unless explicitly configured for a
controlled private QA session. **No tile service has been deployed.**

### Bounded persistent PNG cache

The loopback gateway now caches validated 256x256 PNGs under a **384 MiB /
30,000 tile** default budget (the smaller limit wins). It scans and trims an
existing directory at first use, keeps cache filenames pinned to the immutable
model run/hour/field/zoom/x/y, and evicts least-recently-used entries to avoid
unbounded disk growth. Writes are atomic and quota reservations are serialized
across concurrent renders; corrupted images are never treated as completed
source-backed tiles. The health response now includes a `diskCache` snapshot.

For a dedicated Linux QA host, optionally set:
- `TILE_CACHE_MAX_MB` (whole number, 16–4096; defaults to 384)
- `TILE_CACHE_MAX_ENTRIES` (whole number, 1–250000; defaults to 30000)
- `TILE_CACHE_DIR` (private persistent disk directory)

This is **a safety bound, not a latency cure**: cold tiles still require real
ECMWF network reads and Chromium decode. A separate load-tested CDN/object
store or targeted prewarming would be necessary for consistent large-scale
performance; do not promise that without measurement and permission.

### Real viewport completeness before a pilot hour appears

The optional Android `ReadyTileClient` now requires every visible Leaflet
cell to contain a genuinely loaded, decoded IMG for **all three fields**.
A mere `tileload` count, drained request queue, or old continent's cached
image cannot authorize a new hour. When a completed view pans into uncached
geography, only the authentic ready-tile overlays are hidden and the existing
genuine fallback is shown until complete raster coverage returns. Transient
pan misses do **not** permanently switch back to the on-device decoder;
actual failed requests still trigger the existing safe legacy fallback.
Forecast time and model run remain pinned.

### Reproducible QA without hosting

- Local (Node.js 22): `cd project && node --test forecast-tiles/diskTileCache.test.mjs forecast-tiles/gateway.test.mjs forecast-tiles/metatiles.test.mjs forecast-tiles/pngIntegrity.test.mjs`
- Pure client (Node.js 22): `cd project && node --experimental-strip-types --test src/weather/readyTileClient.test.ts src/weather/readyTilePlan.test.ts src/weather/readyTilePilotConfig.test.ts src/weather/tinyTileDemandModel.test.ts`
- GitHub Actions: `ECMWF Off-Device — Offline Integrity QA`, plus the normal Android PR CI.

These offline tests use **test-only synthetic PNG fixtures**; they do not
claim actual ECMWF meteorological accuracy. For a live QA session the existing
`ready-tiles-live-qa.yml` workflow renders real pinned ECMWF source tiles in
Chromium. Geographic seam, temporal-parity, mobile performance, CDN
availability/cost, and in-person Android acceptance are required before any
default enablement or release merge.

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

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

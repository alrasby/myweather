# ECMWF spatial weather: targeted architecture review and release gates

Scope: MyWeather Pro cloud cover, precipitation, snowfall only. Home/current weather, solar data, wind and temperature are not changed by this review.

## 1. Confirmed architecture

- `modelField.ts` mounts three Leaflet `GridLayer` raster fields per requested ECMWF forecast hour: `cloud_cover`, `precipitation`, `snowfall_water_equivalent`.
- The Open-Meteo `omProtocol` reads compressed OM byte ranges, decodes model data (WASM / worker path) and produces raster tiles. On Android `CapacitorHttp` handles native byte range requests via a six-slot bounded queue. Tile generation and delivery are asynchronous.
- `modelTileReadiness.ts` requires all three fields to complete successfully. This avoids mixing a new hour's rain with an old hour's snow but makes the slowest field determine a frame's earliest display.
- `modelFrameQueue.ts` allows one **incomplete** frame at a time. The next hour is preloaded after the current one is ready; the second lookahead starts only after the first lookahead is ready. `modelField.ts` retains at most three adjacent ready frames plus a fading previous frame; old frames are cleaned up.
- `modelFrameTimeline.ts` never treats a held frame as data for the new timestamp. During a failed-hour cooldown, the time-matched global fallback is used. A normal loading hour gates spatial playback rather than silently advancing the clock.

## 2. Measurement boundaries and how to read them

The optional rain-layer diagnostic now reports the **last 120 samples** independently:

| Probe | Start and end | What it isolates |
| --- | --- | --- |
| Native queue wait p50/p95 | Enqueue -> actual Capacitor request start | Android request saturation |
| Native network p50/p95 | Capacitor request start -> native promise settled | Transport + native-bridge overhead |
| Tile pipeline p50/p95 per cloud/rain/snow | Leaflet `tileloadstart` -> `tileload` | OM reads, WASM decode, worker rasterization and tile handoff **combined** |
| Per-layer elapsed and first-tile | Leaflet `loading` -> `load` / first `tileload` | Visible-viewport backlog and slowest layer |
| Cache eligible/stored/rejected/hits | HTTP range handler | Cache effectiveness without assuming duplicate ranges |
| `crossOriginIsolated`, heap | Browser runtime | Whether shared memory is eligible; heap may be N/A on Android |

**Measurement limitation:** the upstream OM protocol does not currently expose independent per-tile worker decode and worker raster times through our Leaflet adapter. Their sum (plus range read and handoff) is measured as the tile pipeline. Do not infer `decodeMs = tileMs - networkMs`, as concurrent native requests and worker tasks overlap. Accurate decode/raster separation requires upstream worker hooks or a separately instrumented library version; this PR deliberately avoids fragile monkey-patching.

The package documents that without cross-origin isolation `SharedArrayBuffer` is unavailable and model data may be copied to a worker for each tile, increasing main-thread work. This is a **plausible bottleneck** to verify on-device, not a confirmed explanation for every user video. See https://github.com/open-meteo/weather-map-layer/blob/main/README.md.

## 3. Findings and limited fixes

1. Past Android recordings: request-count increases and slow per-layer readiness, even with no `tileerror`. Native read counts alone cannot distinguish transport from wasm decoding and rasterization. New measurements address this.
2. A single hour ahead was insufficient to mask multi-second cold tile generation. Add a bounded **second-hour lookahead**, prepared sequentially only after both earlier hours are fully loaded. This is not uncontrolled parallel decoding. If network/worker latency is longer than the available buffer, playback still shows an explicit preparing state instead of presenting old clouds as a new hour.
3. Continue avoiding expensive DOM `bringToFront` operations for every opacity tick (previous fix), and retain the latest complete hour while waiting. Do not increase native concurrency or the cached byte limit until the new metrics identify transport saturation.
4. The app uses model-derived `cloud_cover`, which represents predicted fraction of cloud cover, **not observed satellite cloud texture**. It cannot reliably reproduce photo-like billows or fine cloud edges. For future forecast times, ECMWF remains the spatial source; observed satellite clouds could be an explicitly labeled **current/near-real-time** optional layer, but cannot replace forecast imagery for future days. Adding such a source requires provider, refresh cadence, attribution, license and mobile-performance review first. The project has not yet selected one.

## 4. Acceptance tests for the next Android build

Use the same device, stable network, viewport, zoom and valid forecast timestamps for before/after comparison. Run a cold start (clear only the weather model cache if available, not saved cities/preferences) and a warm revisit; log diagnostics when requesting frames 0, 1, 2 and when jumping 6+ hours.

| Test | Release gate / evidence |
| --- | --- |
| Source / temporal truth | The requested ECMWF valid time and displayed valid time agree for fully presented frames; if not ready, a visibly loading/held state is shown. Never label a held frame as fresh. |
| Smooth timeline | No frame-ID regressions, no stale displayed spatial forecast on cooldown; consecutive hours have valid independent frames. Observe 60s continuous playback and count all pauses >2s. |
| Pan / zoom | On 10 repeated pans at z3, z5 and z8, no persistent blank rectangles after all three queues complete; newly visible coverage requests are observed. |
| Cold vs warm layer speed | Collect at least 20 samples per layer; compare tile pipeline p50/p95 and per-layer first tile. **Do not claim speedup** until measured on device. |
| Bandwidth / requests | Compare native read and cache hit deltas for cold/warm revisits, not cumulative raw totals. Record failed requests, p95 queue wait and p95 network time. |
| Memory / stability | Run 10 minutes panning and playback; no crash, repeatable escalating tile or request queue growth, or frame accumulation beyond the bounded adjacent window. Where `performance.memory` is unavailable, use Android Studio/ADB memory profiling rather than fabricate a heap number. |
| Cloud shape | ECMWF numerical weather cover may remain smoother than satellite imagery. Distinguish valid coarse model contours from errors: no opaque seam rectangles after queues finish. |
| Regression protection | Wind, temperature, home weather, sunrise/sunset, saved locations and other UX unchanged. |

**Status:** Unit tests and Android CI can verify scheduler logic and build integrity. The field performance targets, worker bottleneck and final visual acceptance require real-device evidence; none are automatically proven by CI.

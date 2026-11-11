# Pre-rendered weather imagery migration: provider evaluation (2026-11-11)

Goal: move ONLY MyWeather's **cloud / rain / snowfall** tile generation away from Android's `.om` decoder and JS workers, retaining the existing wind/temperature map, base imagery, home screen, settings and saved cities.

## Why

Repeated Android tests after PR #63 show substantial first-load delays and stalls at model-hour boundaries. Reducing duplicate network reads and DOM work did not eliminate the expensive client-side OM -> WASM -> worker -> RGBA raster pipeline. Pre-rendered, versioned raster imagery shifts decoding and image generation off the phone. For consistent 60fps animation, prepare adjacent frames before swapping or blending. Do not label a previous image as the new time.

## Existing provider comparison (public vendor documentation)

| Provider | Weather layers | Animation / horizon | Integration | Practical blocker |
| --- | --- | --- | --- | --- |
| **MapTiler Weather** | Cloud cover, precipitation including rain/snow, radar; wind/temp products can remain unused | Vendor advertises interpolated animation up to 60fps; 4–5 day horizon (documentation varies) | Weather JS module is built for MapTiler SDK / MapLibre, **not a drop-in Leaflet PNG URL** | API key, plan/license, and careful coexistence/migration of map engine (without changing existing wind/temp) |
| **Tomorrow.io weather map tiles** | PNG endpoint with documented fields and requested UTC valid time; confirm cloud/snow field entitlements before adoption | Up to 14 days forecast described for map tiles, varies by field and plan | Standard z/x/y PNG tiles compatible with Leaflet; easiest incremental renderer | Paid entitlements / API key, per-tile request pricing and verification of all three required variables |
| **OpenWeather Weather Maps 3.0 Basic** | Cloud cover, rain, snow and snow depth, hourly | Rolling ±5 days | Ready-to-display map tiles, possible Leaflet integration | Listed 250 USD / month for Basic at review; unsuitable default cost for free project without approval |
| **RainViewer free** | Historical radar precipitation only | No long-range forecast/cloud/snow imagery | Standard tiles | Not sufficient for all three forecast layers; 2026 API reductions and personal-use terms |

Vendor references:
- https://www.maptiler.com/weather/
- https://docs.maptiler.com/sdk-js/modules/weather/
- https://docs.tomorrow.io/reference/get-map-tile
- https://openweathermap.org/price
- https://www.rainviewer.com/api/transition-faq.html

## Recommendation and safe rollout

**MapTiler Weather first for an isolated prototype** if a valid MapTiler Cloud plan/key is available and its map engine can coexist with existing MyWeather's untouched wind/temperature. Its advertised smooth interpolation and cloud/precipitation coverage match the visual goal best. Validate independent snow visualization (rain/snow classification) before claiming equivalence.

**Tomorrow.io PNG as the low-risk Leaflet integration alternative**, but only after confirming forecast cloud and snowfall imagery available to the actual API subscription. Do not construct undocumented endpoints, use fake keys or expose private server credentials.

Build a backend or key-approved adapter that supplies a stable contract:
`{runId, validTime, layer: cloud|rain|snow, z, x, y, imageUrl}`.
Prefetch and cache two forecast frames per layer; keep last complete image visible while waiting; stop progress if the actual requested image is not ready; show honest provider attribution. Set caps on cache bytes and concurrent requests.

Acceptance on a representative Android handset:
1. First visible cloud/rain/snow tiles p50 < 1 s, p95 < 2 s (targets, not measurements).
2. Normal hourly playback without repeated > 1 s waits or frozen earlier frames.
3. No new square transparent holes at tile boundaries or during panning/zooming.
4. Stable memory, limited battery use, no exposure of secrets, clear offline fallback.
5. Compare same location/time against incumbent ECMWF and check that values/forecasts are trustworthy.

**Do not change the weather map provider in production until a licensed, authenticated, tested tile source is connected.** There is currently no MapTiler/Tomorrow.io key or plan linked to this repository. A speculative SDK swap would break the working layers without guaranteeing improvement.

# MyWeather resource/performance cleanup — 2026-11-15

Branch: `feature/production-geocoder-ecmwf-startup-resource-safety-20261115`, layered on unmerged PR #92.

## Findings → minimal safe changes

1. **ECMWF source read amplification:** the map could ask OM to validate and read the same variable/hour/viewport separately for adjacent image tiles. Shared, independently abortable in-flight dataset reads now use the exact immutable pinned URL + tile-aligned requested bounds as their key; a pan/new hour never reuses a previous area's data. The diagnostic read-join count is exposed alongside existing copies, reuse, evictions and readP95. This saves *potential* duplicate work; measure actual cold-start p95 on device.
2. **Hidden-map work/battery:** pausing only the animation left ECMWF readers and spatial tile layers active when tabs/background changed. Explicitly call `setVisible(false)` on inactive/hidden map, freeing queued work and viewport worker buffers; resume when the map is visible. Wind and temperature are unaffected.
3. **Non-abortable native HTTP:** formerly the shared 5-slot network gate released a native transport slot on JavaScript abort while the OS call might still be running, enabling request overcommit. Slots now remain held until the underlying native promise ends; timeout opens a 30-second backoff. Browser fallback is bounded. A provider `429` or `403` is not bypassed with a second direct request.
4. **City geocoder:** remove the hard-coded shared Photon demo endpoint. The optional private-provider contract requires a configured credential-free HTTPS `/api` URL, capped requests and OSM attribution; local offline + Open-Meteo remain available. No unnecessary timer/network request for 2-character local queries; 165 ms debounce for longer typed terms.
5. **Unused/duplicate hot paths removed:** repeated per-tile OM data-read callbacks, hard-coded Photon public demo URL, premature native slot release and redundant 2-letter network timer. The modules that are still used by dynamic WebView imports, optional readiness/tide pilots and fallback behavior **were not deleted merely because one static text search saw no import**. Vite's production bundle already tree-shakes unreachable ESM; deleting retained source compatibility files requires a complete import graph and runtime regression proof.

## Resource bounds and acceptance

- `SpatialViewportRenderer`: 3 worker variable slots, at most 2 active renderers, 32 MiB data per worker, 40 queued tiles maximum in front of the admission gate. Per-source byte range cache remains 12 MiB/5 min. No concurrency inflation was introduced.
- `net.ts`: 5 total network slots, **max 3 non-abortable native** plugin requests, 2 reserved for direct web recovery even if the native plugin hangs, and 64 bounded waiters. Native slots do not exceed in-flight OS requests merely because JS aborted. Source-level tests cannot measure Android radio power.
- No public Photon demo traffic in shipping client code. The private provider **has not been deployed**; using Open-Meteo for unseeded cities remains subject to its own availability/terms.
- Exact-head CI must pass TypeScript, full tests, official weather/map validity contracts, Android Lint and signed-identity APK. Low/mid physical Android still needs 20-cycle pan/zoom/long search test with heap, PSS, native request counts, battery mAh/h, startup p50/p95 and visible cloud time. Cold/warm runs must not be conflated.

**Baseline user capture:** first cloud/full complete 8146.8 ms; source read P95 4175 ms; native queue P95 1380.6 ms; worker render P95 47 ms; JS heap snapshot 159 MiB. These are *baseline*, not claimed post-change results.

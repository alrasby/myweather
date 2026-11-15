# MyWeather Pro production multilingual city geocoding

**Status:** implemented client-side production adapter and tested URL/response rules. **Not deployed**: no dedicated/private Photon server, commercial SLA or domain has been provisioned in this repository. No APK should advertise global geocoding as fully online until a real backend has passed production checks.

## Service design

1. Bundled Arabic + English city index gives zero-network, immediate 2-character prefix matches.
2. Open-Meteo geocoding handles most names at three or more characters. It is an independent service; its dedicated commercial endpoint and API terms require a separate license decision for a commercial app.
3. For native-script cities not in the bundled index, the app *optionally* queries an **owner-operated or contracted Photon-compatible HTTPS /api endpoint**, never the public `photon.komoot.io` demo. Query locale follows typed script, with bilingual aliases, capped results, request cancellation, strict coordinate/type validation, small cache and visible OSM attribution.
4. If the endpoint is unconfigured/unreachable/throttled, the app continues serving local and Open-Meteo results. No fake places, no repeated background polling.

**Configure ONLY after the server and licensing are verified:**

```bash
cd project
VITE_MYWEATHER_GEOCODER_URL=https://YOUR-REAL-HTTPS-GEOCODER-DOMAIN/api npm run build:android
```

URL is public, so **never** include an API key, token, username, or password. Mobile endpoint is embedded at build time; changing it requires a newly signed app update. For browser delivery, configure CORS to the known app origin and use a trusted HTTPS host/proxy. The native HTTP plugin talks directly to HTTPS.

## Deploy the service on licensed infrastructure

Photon upstream: https://github.com/komoot/photon

- Reserve capacity: official 2026 guide estimates ~95 GB SSD and recommends ~64 GB RAM for planet-wide data, rising over time. Evaluate a regional dataset or contracted provider if budget/scale does not justify that infrastructure.
- Install Java 21+, obtain a verified Photon release JAR and compatible **licensed** planet or region database. Run the documented `java -jar photon-*.jar serve` command behind an HTTPS reverse proxy on port 2322 (bind Photon to a private network). Follow upstream setup precisely rather than using an unverified Docker image/tag.
- Proxy only `/api`; enforce per-client and server-wide rate limits, upstream timeouts, response size ≤ 256 KB, HTTP 429/503 handling, access logging without raw query retention, no publicly exposed OpenSearch or admin ports.
- Confirm `/api?q=%D8%AF%D9%85%D8%B4%D9%82&lang=ar&limit=6&layer=city` and other cities from Arabic, Japanese, Hindi, Russian and English. Check local Unicode name and coordinates against independent geospatial references.
- Plan an atomic dataset refresh, disk budget for old/new versions, health checks, monitoring, TLS certificate rotation and privacy policy. Self-hosted OSM data commonly carries ODbL attribution/share-alike obligations; verify the exact dataset licenses for your distribution.
- Obtain/confirm commercial use terms for Open-Meteo separately. Source attribution is not a substitute for a service contract.

## Release QA

`node --experimental-strip-types --test src/weather/privateGeocoder.test.ts src/weather/photonCity.test.ts src/weather/searchScript.test.ts`

Physical Android acceptance is required: input two letters (local), native-script obscure town absent from local index, full Arabic name, no response/429, offline/online, copy/paste/rapid erase, search suggestions and provider attribution. Test forced low-memory/background/foreground. Record real p50/p95 for provider latency and memory. CI passing without a deployed endpoint verifies the **adapter**, not external reliability.

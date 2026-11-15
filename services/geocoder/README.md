# MyWeather private world city geocoder

Data source: [GeoNames](https://www.geonames.org/) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Imports official `cities500.zip` with populated cities and administrative seats, including the alternate names in many scripts. It is **not** an address-level or every-village search engine, and does not guarantee every local spelling. No connection to the public Photon demo.

Service is independent from MyWeather Tide Engine. Railway root directory: `/services/geocoder`, persistent /data volume >=1GB. Runtime has no third-party dependencies. On first boot it downloads the official GeoNames archive once, builds a SQLite prefix index atomically, then reports ready. Every 30 days it refreshes the index without corrupting the prior data if an import fails.

- `GET /health` returns HTTP 503 until index ready, then version/counts and HTTP 200
- `GET /api?q=دمشق&lang=ar&limit=6&layer=city&layer=locality` returns GeoJSON FeatureCollection with true GeoNames identifiers and sources
- GET-only; 12 active DB requests, per-client 45/minute, 480/min service; cache for 10 minutes; CORS on public read-only endpoint; no query/location/IP logging
- Queries must be at least 3 Unicode characters. The app answers 2-character suggestions from its offline bundled index.
- Search parser translates returned GeoNames features into the application's Place type. Attribution must say © GeoNames, CC BY 4.0 (not OSM for these records).

Run tests: `cd services/geocoder && python -m unittest discover -s tests -v`.

**Operations:** monitor volume free space, index freshness, /health, provider errors and response P95. Railway-generated TLS is used. An external SLA is not claimed; this is a self-hosted city-data service billed via the user's Railway workspace. For production, consider WAF/DDOS protection and reserved capacity when public use grows.

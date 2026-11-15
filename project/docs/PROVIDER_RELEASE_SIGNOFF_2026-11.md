# طقسي — provider-rights and scientific release sign-off (15 Nov 2026)

**Status: NOT approved for public distribution.** This document is an operator's
acceptance record, not a legal opinion. It does not modify forecast data, switch
providers, claim a scientific certification, or grant rights to third-party services.
Avoid inferring permission merely because an HTTPS endpoint currently responds.

| Live use | Actual implementation | Confirmed published rules | Required before public release |
|---|---|---|---|
| Open-Meteo forecast, marine, air-quality, public geocoding and ECMWF spatial data | `project/src/weather/api.ts` and `modelField.ts` use free public endpoints; marine tide display is an estimated mean-sea-level service | Open-Meteo **API service** free tier is non-commercial only and rate limited; underlying public **data** are generally CC BY 4.0 and require attribution. Commercial use requires an appropriate paid endpoint/plan, or an independently authorized self-hosted source | Owner chooses and documents whether app is strictly non-commercial (no ads/subscriptions/promotional use), or provisions authorized commercial access; confirm spatial .om terms and projected traffic separately. Preserve visible source attribution. |
| Esri World Imagery tiles and map labels | `MapScreen.tsx` reads `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer` without a token | Esri requires both Esri and image **data provider** attribution. Documentation for token-based static/raster basemap tiles includes usage limits and billing; access to an unauthenticated public tile URL does not automatically prove authorized commercial distribution | Validate exact World Imagery MapServer terms, app distribution rights and provider credit with Esri or switch to an authorized basemap endpoint. Preserve source credits in map and settings. Do NOT bulk-copy imagery into APKs or self-host tiles. |
| MET Norway | Secondary point forecasts from `api.met.no` | Data are generally CC BY 4.0/NLOD 2.0 including commercial reuse, subject to appropriate data credits, identification and load/caching requirements | Check request identification, no provider conflation, appropriate credits, and real-network rate behaviour |
| GeoNames / city lookup | Self-hosted global city geocoder in Railway, with GeoNames-derived indexes | GeoNames data are CC BY; required attribution and license apply to compiled aliases too | Retain GeoNames credit, provenance and operator verification of service capacity |
| Experimental PyFES/FES2022b | Not active in the Android app; current fallback marine estimate is not equal to a calibrated harbour tide | Official atlas requires authentic licensed distribution, verified harmonics and station-gauge datum alignment | Remain OFF until real atlas manifest, HTTPS service, matched gauges and approved rights; no fake world-wide accuracy |

**Authoritative published documents (checked 2026-11-15):**
- Open-Meteo service terms: https://open-meteo.com/en/terms
- Open-Meteo pricing/commercial licence: https://open-meteo.com/en/pricing
- Open-Meteo data licence: https://open-meteo.com/en/license
- Esri developer attribution: https://developers.arcgis.com/documentation/mapping-and-location-services/mapping/basemaps/introduction-static-basemap-tiles-service/
- Esri World Imagery data attribution example: https://developers.arcgis.com/maplibre-gl-js/maps/raster-tile-basemaps/display-multiple-basemap-layers/
- MET Norway terms: https://docs.api.met.no/doc/TermsOfService.html
- MET Norway data licence: https://api.met.no/doc/License

## Release evidence and responsible owner acceptance

No signature or compliance claim has been supplied. Owner must fill the fields
below *after* reviewing distribution mode and actual provider terms.

- Distribution classification (non-commercial/no-ads vs promotional/paid/ads): **NOT REPORTED**
- Esri image tile authorization + specific provider credit: **NOT VERIFIED**
- Open-Meteo API service use tier + traffic sizing: **NOT VERIFIED**
- GeoNames/MET Norway source attribution and caching review: **PENDING**
- Validated physical low/mid Android + rendered clock/ECMWF Zoom 3–8: **PENDING**
- FES licensed atlas / local gauge validation: **NOT ACTIVE, NOT A RELEASE CLAIM**
- Reviewer identity / UTC acceptance / evidence links: **NONE — NO RELEASE APPROVAL**

**Technically safe candidate policy:** Ship only forecast/map/tide claims backed
by their *actual present source*; do not describe EOT20/FES/AI pilot as live.
Do not merge the stacked PRs to `main` until both technical and rights
acceptance are documented. Internal signed QA APK availability is not a
distribution licence or permission to use public services commercially.

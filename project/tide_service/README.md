# MyWeather Pro — real astronomical tide engine (isolated FES2022b adapter)

This folder does **not** contain FES2022b grids and is **not active in the Android app**. The currently deployed Android tide card still uses Open-Meteo Marine \`sea_level_height_msl\` when trustworthy values exist. Do not claim FES forecasts until the operator installs the official atlas, configures the service, tests real forecasts and deploys an HTTPS endpoint.

## Source and scientifically correct prediction

Preferred global source: **FES2022b ocean tide elevations** (34 constituents, global 1/30° grid; native finite-element grids also available), CNES/LEGOS/Noveltis/CLS, via authenticated AVISO distribution:
https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html

Official prediction library: **PyFES v2026.3.1** or a newer compatible, tested release:
https://cnes.github.io/aviso-fes/
Use the official Darwin/Schureman astronomical predictor: it interpolates complex harmonic constants for a geographic point, evaluates astronomical arguments and nodal corrections and sums constituents. This is a future-time *prediction*, not maximum/minimum detection in recent sea-surface observations. PyFES requires the actual licensed FES atlas files: the bundled PyFES demo grids are older/lower resolution and **must never** be passed off as FES2022b.

FES output uses the units of the atlas (typically **centimetres**), and long-period equilibrium correction is computed in cm. The adapter converts the correct cm ocean-tide results to metres and rejects PyFES flags 0 (undefined) and negative (spatial extrapolation). It does not invent or interpolate unsupported cells, and derives high/low events from a real five-minute PyFES forecast grid. The five-minute sampling interval is the resolution of event times, not a claim of five-minute statistical accuracy.

Heights are relative to the **atlas mean sea surface**. They are **not chart datum/LAT**, observed sea level, storm surge or harbour depth; they must not be shown as navigational predictions.

## Activation prerequisites (not completed)

1. Review and accept AVISO Issue 20 license: https://aviso.altimetry.fr/en/data/data-access/fileadmin/documents/data/License_Aviso.pdf . FES heights are usable for commercial derived forecasts subject to attribution and conditions; **do not redistribute or commit raw atlas grids**. FES currents have separate restrictions.
2. Obtain FES2022b ocean elevation grids from AVISO's authenticated storage. Keep this data off GitHub and outside APKs. Validate the correct edition, grid mask, unit metadata and provenance against the official handbook.
3. Install the official PyFES on a dedicated tide service server (not Android):
   \`conda install -c conda-forge pyfes\`, or a pinned equivalent after verifying supported versions.
4. Supply an operator-managed YAML config pointing to the actual FES2022b constituent files; see official PyFES configuration documentation. Set \`FES2022_CONFIG=/secure/path/fes2022b.yaml\`. The adapter refuses to produce data if atlas/config is missing.
5. Offline unit-contract check from the project folder: \`python -m unittest discover -s tide_service -p 'test_*.py' -v\` (no atlas or network needed).
6. With a **real atlas** installed, run:
   \`python -m tide_service.fes2022_predict --lat 23.588 --lon 58.3829 --start 2026-11-14T00:00:00Z --hours 48\`.
   Confirm model provenance, positive interpolation flags, realistic levels and high/low times. Compare Muscat with official local gauge and port tide tables before activation. Repeat Dubai, Mumbai, Helsinki, Hammerfest and inland/unsupported water cells. This integration test cannot run in GitHub CI without official data and must not be reported as passed.
7. Deploy a private authenticated HTTPS gateway, rate limiting, caching by point/model/version/UTC interval and independent source attribution. The server should return only computed predictions; clients must not download the raw global model. The APK must have a feature flag default OFF until production validation.

## Operational quality gates

The FES tidal model is an astronomical *base*. Correct final coastal water-level forecast requires measured surge, wind setup, barometric response, shallow-water resonance and a locally confirmed height datum. Compare matched gauge and base-model values at the same UTC time and reference datum. Never mix mean sea level with a harbour chart datum without a surveyed conversion.

Before calling a station/model **high accuracy**, require:
- At least 30 days of trusted timestamp-aligned observations, ideally 6+ months spanning seasons/storms;
- Separate training, validation and chronologically held-out test periods; no look-ahead leakage;
- Maximum error, MAE/RMSE in centimetres and high/low event timing MAE in minutes, broken down by station/coast/season;
- Gauge quality flags, coverage and datum provenance, and explicit uncertainty;
- Compared benchmarks: PyFES alone, PyFES + persistent station bias, PyFES + learned meteorological residual;
- AI activates **only where its out-of-sample errors improve upon FES + bias**; never train on generated/guessed gauges or fabricate missing predictions.

A compact residual learner could use preceding trusted gauge readings and forecast pressure, wind vector, air pressure trend, and tidal phase to estimate *non-astronomical residual*, with a strictly capped correction, calibration and automatic shutoff on data drift. ML must never replace PyFES's lunar/solar harmonic forecast. A **dormant 4-weight ridge residual learner** is now implemented in `gauge_residual.py` and tested with synthetic *contract-only* fixtures. It requires at least 30 days of datum-aligned, verified gauge observations and a chronological held-out segment, and refuses activation unless it beats an independent constant-bias baseline by at least 10% and 1.5 cm MAE. It predicts only the meteorological residual; it is not integrated or active in Android or the FES production adapter, because no genuine gauge source or model data has been provided. The synthetic tests are **not** tide accuracy validation.

## Existing card

Keep the established bottom-of-page tide-card position and auto-hide for true inland/no-data locations. When the service eventually becomes available, show provider, datum, reference location and confidence. Do not mix FES astronomical heights with Open-Meteo combined sea-level values; they represent different physical quantities and references.


## Integrity attestation is mandatory for production
PyFES by itself ships only the algorithm, NOT the FES2022b model. A production
entrypoint now requires BOTH FES2022_CONFIG and FES2022_MANIFEST. The private
manifest must contain:
- edition = FES2022b
- producer = CNES/LEGOS/Noveltis/CLS
- quantity = ocean_tide_height
- units = cm
- datum = atlas_msl
- format = cartesian-34 with **34 actual files**, or native-34 with one full native atlas
- config_sha256 = actual SHA-256 of loaded YAML
- files = full list of {path, sha256} objects, pointing at **real** atlas grids.

All SHA-256 values are checked on service initialization, and tiny
demonstration grids (total size under 500 MB) are rejected. This is
**operator-attested integrity**, not a digital signature from CNES. Obtain
and independently verify all the source data via AVISO. Do not commit
the manifest or source grids to the public repository. Missing or invalid
metadata means the program produces an explicit unavailable response with
no fake sea-level points.


## Bounded FES forecast gateway (operator pilot; NOT active in Android)

The new tide_service.gateway starts only when the licensed, original
FES2022b constituent files, hash-verified manifest and explicit enable switch
are present. It is NOT a forecast endpoint that has been deployed. Never use
the PyFES example grids as genuine FES2022b or rely on the offline unit tests
as scientific verification.

Operator commands, with actual licensed data and a verified configuration:

    cd project
    export FES2022_CONFIG=/secure/fes2022b.yaml
    export FES2022_MANIFEST=/secure/fes2022b.manifest.json
    export FES2022_BBOX=52,20,62,28
    export TIDE_SERVICE_ENABLED=1
    export TIDE_SERVICE_BIND=127.0.0.1
    export TIDE_SERVICE_PORT=8765
    python -m tide_service.gateway

FES2022_BBOX is optional; the example bounding box is a regional shard
and intentionally does not cover Muscat. For Muscat, configure a shard that
includes Muscat or provision a full-atlas service. A real global product
must operate enough independent regional shards or have adequate memory
for the complete model. The code uses the official PyFES regional bbox
loader to reduce memory; no fake worldwide coverage from one small shard.

After obtaining the genuine atlas, smoke test a covered area (choose
start time within 24 hours of current UTC):

    curl 'http://127.0.0.1:8765/v1/tides?lat=23.588&lon=58.3829&start=2026-11-14T00%3A00%3A00Z&hours=48'

The sample time above is historical after 2026-11-15; replace it with
the appropriate CURRENT UTC time aligned to five minutes during actual QA.

This server:
- Binds to loopback only, never directly to a public network interface.
- Accepts only bounded lat/lon/UTC/hour values, 12 to 72-hour windows.
- Computes just one PyFES request at a time (others return 503).
- Has a 96-entry bounded LRU, a bounded global request rate, no API-key
  exposure and no query-string/location access logs.
- Never rounds together two distinct coastal coordinates in its cache.
- Returns no samples for missing or invalid source files/quality flags.
- Includes a health probe and explicit unavailable status for errors.

Deploy a separate properly authenticated HTTPS reverse proxy and per-IP
rate controls before considering internet access. CORS Origin allowlisting
is not an authentication mechanism. Do NOT embed licensing credentials,
administrative tokens or raw model data in the APK.

The response identifies itself as physical_model_unvalidated_at_local_gauge.
A strict future Android schema parser in src/weather/fesTideContract.ts
checks the model source, units, datum, exact UTC samples, location,
interpolation quality and physically genuine high/low turning points.
It intentionally returns isApprovedForPublicDisplay=false. Android does
NOT call this service or replace the current Open-Meteo Marine tide card.

## Scientific verification before enabling the learned correction

tide_service/gauge_validation.py calculates chronologically held-out
MAE, RMSE, p95 absolute sea-level error (metres), gauge station-bias
baseline and matched high/low event timing error (minutes). Actual gauge
observations MUST already have a documented datum conversion to the FES
atlas mean sea surface, human-reviewed source provenance, valid quality
flags and UTC observations covering 30+ days. The evaluation cannot
prove source provenance independently; a named human validator must
check the conversion and station source.

The four-weight pressure/wind residual model remains disabled until
it beats the historical bias-only baseline by >=10% AND >=1.5 cm on
an unseen future holdout. For prospective forecasting, meteorological
features must be actual forecasts AVAILABLE at forecast issuance
time, not later observed weather. A zero-gauge station cannot be
calibrated via invented readings or another station's datum.

Run local offline checks (synthetic fixtures ONLY):

    cd project
    python -m unittest discover -s tide_service -p 'test_*.py' -v
    node --experimental-strip-types --test src/weather/fesTideContract.test.ts

No official FES2022b atlas or validated Omani station gauges have been
provided or activated; no marine accuracy or navigation claim is implied.

### Leakage prevention enforced by code

GaugeRecord now includes meteo_issued_at_utc and meteo_source. The residual learner rejects every pressure/wind training record unless it identifies a source forecast issued **at least one hour before** the predicted tide target and no more than ten days earlier. Historic observed pressure or wind recorded at/after the event cannot prove future prediction skill. FES-only and station-bias evaluation is still possible without archived meteorological forecasts. The unit fixtures merely exercise this contract, and cannot prove observations were genuinely obtained before issuance.

## PyFES without AVISO+ — genuine NOAA station harmonics (pilot)

PyFES Darwin also accepts known harmonic constituents from observed tide
stations. A station-only adapter (noaa_station_pyfes.py) now supports
verified NOAA CO-OPS harmonic metadata, without mislabelling it FES2022b:
- Fixed NOAA HTTPS URLs, seven-digit station ID only, and exactly one real
  tidal station metadata record.
- NOAA metric harmonic amplitudes converted from metres to PyFES centimetres;
  Greenwich (GMT) phases and eight or more finite named constituents.
- Calls the official PyFES evaluate_tide_from_constituents when installed;
  computes only for the exact published station location, never an arbitrary
  nearby city or coastline. Not a global atlas.
- Returns source, station, harmonic-zero datum (not chart datum), five-minute
  values and physical turning points; never suitable for navigation.

Operator-only smoke (needs official PyFES and NOAA network):
    cd project
    python -m tide_service.noaa_station_pyfes --station 9414290 --start 2026-11-14T00:00:00Z --hours 24

Compare the harmonic forecast with NOAA's published predictions under a
common vertical datum before public activation. No PyFES model data, NOAA
station constants, credentials, or fabricated world coverage ship in APK.
The default Android card is NOT connected to this pilot; the FES2022b
licensing, dataset, HTTPS deployment and gauge-validation requirements remain.

The Open-Meteo Marine line chart remains clearly attributed as modelled sea
level, but its coarse turning points are no longer presented as verified
astronomical high/low tides. Verified astronomical tides await a real source.
Official docs:
https://cnes.github.io/aviso-fes/user_guide.html
https://api.tidesandcurrents.noaa.gov/mdapi/prod/

## Global provisional PyFES service without AVISO+ — open EOT20 atlas

**Now implemented:** `eot20_global.py` verifies the original worldwide EOT20
NetCDF harmonic grids, prepares an explicit PyFES Darwin config and SHA-256
manifest, and evaluates physical five-minute astronomical tide predictions
without fabricating samples. `eot20_server.py` reuses the bounded loopback
gateway, but reports source **EOT20** (not FES2022b). Android has a strict
HTTPS-only EOT20 reader and prioritizes verified predictions over the
source-attributed estimated Open-Meteo sea-level turning points **only when
a service URL and explicit build flag have been set**. The ordinary APK ships
with no EOT20 server URL, atlas or data access and therefore uses the
honest estimated marine display instead. No misleading global activation.

EOT20 is the ocean elevation model produced by DGFI-TUM, openly distributed
at https://doi.org/10.17882/79489 under Creative Commons Attribution 4.0.
Credit: Hart-Davis M., Piccioni G., Dettmering D., Schwatke C., Passaro M.,
and Seitz F. (2021), Earth System Science Data 13, 3869-3884,
https://doi.org/10.5194/essd-13-3869-2021.
It is a **1/8 degree** worldwide satellite-altimetry harmonic model (17
ocean-elevation constituents); it is distinct from AVISO's finer FES2022b.
Near coastlines or narrow waterways its errors can be significant. It is a
prediction relative to the atlas mean sea surface, not harbour chart datum,
observed storm-surge water level, or navigation-grade tide.

### Operator deployment (not performed; requires actual atlas & server)

1. Download the **final** openly published EOT20 from SEANOE, following
   https://geoscienceaustralia.github.io/eo-tides/setup/ .
   Extract the nested `ocean_tides.zip` to an operator-private directory.
   It must contain exactly the 17 full-world `*_ocean_eot20.nc` files; do not
   use partial/demo/mislabeled grids.
2. Install Python 3.12, PyFES 2026.5.2 (or newer compatible tested release),
   PyYAML, NumPy and NetCDF4 on a trusted service machine. For example:
   `python -m pip install --only-binary=:all: pyfes==2026.5.2`
3. From `project/` create an operator-owned config and SHA-256 manifest
   outside GitHub and Android:

       python -m tide_service.eot20_server --prepare \\
         --atlas-dir /secure/EOT20/ocean_tides \\
         --config /secure/EOT20/eot20.yaml \\
         --manifest /secure/EOT20/eot20.json

   This validates the presence of all 17 genuine-looking global files,
   amplitude/Greenwich-phase variable names, grid extent, units and hashes.
   The SHA-256 checks attest consistency with operator-provided source files;
   they do **not** cryptographically prove original publisher authenticity.
   The operator must verify dataset provenance and the CC-BY obligations.
4. Confirm with actual model files:

       cd project
       EOT20_CONFIG=/secure/EOT20/eot20.yaml \\
       EOT20_MANIFEST=/secure/EOT20/eot20.json \\
       python -m tide_service.eot20_global --lat 23.588 --lon 58.3829 \\
         --start <current UTC on a 5min boundary> --hours 48

   Verify with official tide tables/gauges for Muscat, Cape Town, Rabat,
   New York and Hammerfest at the **same datum**. Reject missing coastal
   coverage, flagged extrapolations or unacceptable deviations. Do not
   claim gauge calibration merely because the computer can load the atlas.
5. Only after scientific QA and real capacity planning, run the loopback
   gateway with `TIDE_EOT20_ENABLED=1`, `EOT20_CONFIG`, `EOT20_MANIFEST`,
   `TIDE_SERVICE_BIND=127.0.0.1`, `TIDE_SERVICE_PORT=8765`.
   Use a real HTTPS reverse proxy with authentication/rate protection,
   CORS allowlisting for web preview, uptime/health checks and enough
   RAM for all 17 global grids or explicitly bounded geographical shards.
6. Build Android with these **non-secret public config values**:

       VITE_EOT20_TIDE_ENABLED=1
       VITE_EOT20_TIDE_GATEWAY=https://your-owned-tide-host.example

   The client appends `/v1/tides`, requests a 48h UTC source forecast,
   verifies provider/coordinates/units/5-minute samples/extrema and displays
   source EOT20 + scientific/non-navigation caveat. On any network, source
   or parsing failure it falls back to the existing attributed Marine
   estimate; no fake PyFES reading is shown. Do not put confidential API
   keys in client environment variables. Do not enable this flag with a
   private loopback-only/untested endpoint.

**Not yet completed:** acquisition/hosting of the external global EOT20
NetCDF atlas, official tide-table/gauge accuracy acceptance, live HTTPS
server deployment, and physical Android world-coast QA. The default build
therefore cannot truthfully be called a fully activated global PyFES
service. AVISO+ FES2022b remains a later and independent upgrade path.

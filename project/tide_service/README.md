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

A compact residual learner could use preceding trusted gauge readings and forecast pressure, wind vector, air pressure trend, and tidal phase to estimate *non-astronomical residual*, with a strictly capped correction, calibration and automatic shutoff on data drift. ML must never replace PyFES's lunar/solar harmonic forecast. AI correction **is not implemented or active yet** because the project lacks trusted gauge feeds and cross-validated training data.

## Existing card

Keep the established bottom-of-page tide-card position and auto-hide for true inland/no-data locations. When the service eventually becomes available, show provider, datum, reference location and confidence. Do not mix FES astronomical heights with Open-Meteo combined sea-level values; they represent different physical quantities and references.

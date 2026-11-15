# MyWeather Pro: PyFES / EOT20 global service deployment

## Verified science and provenance

The actual EOT20 (not FES2022b) 17-grid ocean elevation atlas is a
CC BY 4.0 research model from DGFI-TUM/SEANOE, Hart-Davis et al. (2021),
https://doi.org/10.17882/79489. The pinned bootstrap downloads the
**explicitly modified** float32/amplitude/phase-only redistribution
https://github.com/mattmonkey55-afk/eot20-grids/releases/tag/v1.0.0,
documented in that repository's NOTICE-EOT20.txt. The archive digest is
hardcoded and verified against the downloaded file; this is not the
publisher's original archive signature. The original SEANOE files may
instead be installed manually and verified using `eot20_server --prepare`.

The result is a physical astronomical harmonic prediction relative to
EOT20 atlas mean sea surface, NOT observed coastal water level, storm surge,
official harbour chart datum, charted water depth or navigation-grade advice.
No gauge calibration or accuracy comparison has yet been certified.

## Operator deployment on Railway

Connect the Railway service to repository `alrasby/myweather` and the
approved deployment branch (currently the **unmerged draft PR #89**).
Only use an independently configured staging environment at first.
Source root remains repository root. The committed `railway.json` specifies
`project/tide_service/Dockerfile`; if ignored by your Railway environment,
select `DOCKERFILE` and specify this path in the service build settings.

**Attach one persistent volume** at `/data/eot20` with **at least 5 GB**
free before enabling startup. Set enough RAM for the entire 17-constituent
model and runtime (start with 4 GB, verify actual metrics; adjust based on
memory usage). Do not store the atlas in the APK, Git history or an
unprotected public bucket. EOT20 download occurs only at container startup,
and only after a pinned SHA-256 check. The download requires external
network access from the instance.

Set the following non-secret service variables (Railway supplies `PORT` and
`RAILWAY_ENVIRONMENT_ID`):
```env
TIDE_EOT20_ENABLED=1
TIDE_EDGE_TLS_TERMINATED=1
EOT20_DOWNLOAD_PINNED=1
EOT20_DATA_DIR=/data/eot20
TIDE_ALLOWED_ORIGINS=capacitor://localhost,http://localhost
```

The Docker entrypoint starts as root briefly ONLY to set ownership of the
root-mounted volume directory, then immediately drops to UID 10001 via
`gosu`. Python does not run as root. Railway volume permissions can differ
with platform releases; the operator must confirm actual volume ownership
and logs rather than assuming deployment succeeded.

Enable a **Railway managed HTTPS public domain** after startup.
The container binds only the internal HTTP port supplied by Railway. Do not
expose container HTTP directly over the public internet or install any
client-side secret. CORS is explicitly *not* authentication. This is a bounded
public scientific forecast endpoint (currently 90 requests per minute
globally, one in-flight PyFES compute, maximum 24 server request threads).
It is not scaled for unlimited clients. Monitor usage before increasing limits
or adding replicas, and enforce edge request controls when capacity grows.

## Readiness/acceptance

1. Deployment logs must contain `EOT20_GLOBAL_READY` only after verifying
   the model and successfully loading it in PyFES.
2. `GET https://<owned-railway-domain>/healthz` must return:
   `{"ready":true,"source":"EOT20","public":false}`.
   The `public:false` field means *not certified for navigation*, and does
   not indicate the endpoint is privately network-routed. No healthy response
   must be sent before the atlas is loaded.
3. At a present UTC time on a five-minute boundary, request
   `/v1/tides?lat=23.65&lon=58.7&start=<UTC>&hours=12` (URL-encode the UTC
   timestamp). Verify exact 145 genuine five-minute samples, derived extrema,
   source `EOT20`, method `PyFES Darwin global astronomical tide`,
   CC BY attribution, non-navigation disclaimer and physical datum.
4. Run staging Android APK with `VITE_EOT20_TIDE_ENABLED=1` and
   `VITE_EOT20_TIDE_GATEWAY=https://<owned-railway-domain>` injected at
   **web build time**. The default APK intentionally does not include a
   made-up domain. Confirm Muscat, Cape Town, Rabat, New York and Hammerfest
   time series and fail-closed fallback to clearly labelled Open-Meteo
   estimates when the tide service is unreachable.
5. Compare high/low times and height ranges against gauge/official reference
   predictions using a documented common datum. This is an explicit
   scientific-quality gate, not satisfied merely by successful CI.
6. Only after on-device usability, memory/latency and scientific QA should
   the operator turn this into a generally available endpoint.

## CI evidence and recovery

`.github/workflows/eot20-global-live-qa.yml` downloads the exact
checksum-pinned modified EOT20 archive in GitHub Actions, rejects dangerous
tar members and unexpected files, validates all global NetCDF grids, loads
them via official PyFES, runs 12-hour physical forecasts at five ocean regions,
checks actual local HTTP API and builds/tests the production Docker image.
A successful unit test using synthetic mathematical fixtures alone is
**never** labelled a real-world marine forecast.

The model's data files remain in the Railway volume. To roll back,
turn `TIDE_EOT20_ENABLED=0` to fail-closed or roll back to the previous
service deployment, and rebuild Android with
`VITE_EOT20_TIDE_ENABLED=0` if needed. Do not overwrite or remove
operator-owned dataset files automatically. Do not claim global coverage
for a regional `EOT20_BBOX` shard.

The future AVISO+ FES2022b model will be a separate scientific source.
Do not mislabel the open EOT20 atlas as FES2022b.

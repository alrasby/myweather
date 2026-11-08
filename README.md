# MyWeather Pro

Existing Android weather application, restored from the supplied **MyWeather 1.0.47 (versionCode 48)** source archive. Package: `net.nabdhserv.myweather`. **This is not a new project.**

## Source layout

To preserve the archived test scripts and all previously built assets, import the archive *without flattening its directories*:

- `project/`: original Capacitor/React/Android source, resources, assets and reports.
- `connection-tests.mjs`, `map-tests.mjs`, `precip-data-tests.mjs`: deterministic weather regression tests at repository root.
- `render-tests.mjs`, `live-grid-test.mjs`, `worldwide-tests.mjs`: historical optional checks, not mandatory in CI (graphics dependency/live API).
- `.github/workflows/android-ci.yml`: CI verification and build.

The source archive import is **not finished** until all original files are committed and CI passes. This PR must remain draft until then.

## Reproduce an Android debug build

Requires Node.js 22, Java 21, Android SDK 36 and Gradle 8.14.3 wrapper.

```bash
node scripts/verify-import.mjs
cd project
npm ci
npm run typecheck
npm test
npm run build:android
cd ..
node connection-tests.mjs
node map-tests.mjs
node precip-data-tests.mjs
cd project/android
chmod +x gradlew
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

## Release signing

Never commit the original keystore, `keystore.properties`, passwords or tokens. Store these GitHub Actions secrets: `MYWEATHER_KEYSTORE_BASE64`, `MYWEATHER_KEYSTORE_PASSWORD`, `MYWEATHER_KEY_ALIAS`, `MYWEATHER_KEY_PASSWORD`. The release job only runs by manual dispatch on `main` and verifies the certificate SHA-256 against the original fingerprint recorded in the source archive before uploading an APK.

The archived `RESUME.md` and `BUILD_STATUS.md` refer to tests performed in the former environment; they are not proof of CI or real-device success on this repository.

## Safeguards

- Preserve application ID, version, UI, adaptive icon and feature behavior.
- Work on feature branches and reviewable PRs.
- Run network and map tests on physical Android after CI success; avoid claiming live API coverage from mocks.

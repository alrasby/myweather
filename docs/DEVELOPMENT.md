# Development notes

The repository contains the existing Android application under `project/`. Its application ID is `net.nabdhserv.myweather`; the public introduction is in the root README.

## Source layout

- `project/src/`: React interface, weather providers and map rendering.
- `project/android/`: Capacitor Android project, resources and native integration.
- `project/scripts/`: build verification and regression checks.
- `services/geocoder/`: self-hosted multilingual city lookup service.
- `.github/workflows/android-ci.yml`: source checks, dependency audit, unit tests, browser evidence, Android tests and lint.
- `.github/workflows/android-play-candidate.yml`: signed APK/AAB preparation for selected main-branch changes and manual dispatch.

The source originated from the supplied MyWeather archive. Historical reports and archived root-level tests describe earlier environments; use current workflow results as evidence for current source.

## Local checks and Android build

Use Node.js 22, Java 21 and Android SDK 36. The Gradle wrapper is included.

```bash
cd project
npm ci
npm run typecheck
npm run qa:release
npm run build:android
node scripts/verify-android-bundle.mjs
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The public geocoder endpoint used by Android CI is configured through `VITE_MYWEATHER_GEOCODER_URL`; see the workflow for the current build environment.

## Signing and publication

Keep keystores, passwords and tokens out of Git. Existing workflows load signing material from GitHub Actions secrets and verify package identity, build number, signature and alignment. The signed candidate workflow creates APK and AAB artifacts; Google Play upload requires an explicit opt-in and configured credentials.

README or image-only updates do not require an application version bump. Physical-device checks remain useful for gestures, sensors and native behavior.

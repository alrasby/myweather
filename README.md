# MyWeather Pro

This repository is being initialized from the verified **MyWeather 1.0.47 (versionCode 48)** source archive. Android package: `net.nabdhserv.myweather`.

## Restore and build

Requires Node.js 22, Java 21, Android SDK 36 and Gradle 8.14.3 (wrapper).

```bash
npm ci
npm run typecheck
npm test
npm run build:android
chmod +x android/gradlew
cd android
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Do not regenerate the Android project or overwrite the existing launcher assets. Source import is reviewed in a PR before merging.

## Release signing

Never commit a keystore, `keystore.properties`, passwords, or APK signing material. Set GitHub Actions secrets: `MYWEATHER_KEYSTORE_BASE64`, `MYWEATHER_KEYSTORE_PASSWORD`, `MYWEATHER_KEY_ALIAS`, `MYWEATHER_KEY_PASSWORD`. A manually dispatched workflow on `main` verifies the signed APK. Compare the actual signer SHA-256 against the recorded certificate in `BUILD_STATUS.md` before distributing any update.

Existing documentation (`RESUME.md` and `BUILD_STATUS.md`) describes verification performed in the previous environment; those reports are not a substitute for new GitHub Actions runs or real-device tests.

## Release safeguards

- Preserve application ID, version code/name, adaptive icon and existing UI.
- Deploy changes through feature branches and reviewable PRs.
- Prefer deterministic fixtures for API tests; avoid requiring live network to pass CI.
- Test networking and map layers on physical Android after passing CI.

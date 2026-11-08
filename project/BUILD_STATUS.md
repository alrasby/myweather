# MyWeather 1.0.47 (versionCode 48)

Package: net.nabdhserv.myweather

Changes in 1.0.47: connection scheduling/timeouts/429 handling, real cached forecast only, immediate coordinate-based weather, measured GPS precision, Unix timestamps, regional-first map with persistent cache. See RESUME.md for checks and limitations.

Preserved 1.0.46 changes:
- Short, fading wind trails; projected advection avoids latitude-dependent apparent speed; screen-space particle distribution; old trails clear when scrubbing time.
- Liquid precipitation (rain + showers) is separate from snowfall and ground snow depth.
- Actual model cloud cover renders independently; dense clouds do not imply measured rain.
- Global sampling 48x28 (24x14 in data saver), extending to Web Mercator limits; adaptive viewport detail fetches independently, including close zoom.
- Missing cells remain missing rather than being filled with neighbouring precipitation; ordered API locations avoid snapped-cell assignment errors.
- Matching cloud/rain/snow/snow-cover compositing for GLES3 and Canvas; improved low-rainfall precision in RGBA8 fallback.
- Static Capacitor assets; no web server needed; no Grok folder.

Validation: TypeScript, deterministic grid tests, live Open-Meteo fetch, actual Canvas rendering and wind motion, GLES3 shader compile/link and framebuffer readback using Mesa software rendering. No physical Android device or Android WebView test was available. Model forecasts and interpolated display are not live satellite/radar imagery; global sampling cannot resolve every local shower.

Build: Java 21, Android SDK 36, Gradle 8.14.3, AGP 8.13.0.
Run npm ci then npm run build:android from project. Restore your original android/keystore.properties and keystore outside any distributed archive, then run android/gradlew assembleRelease. Keystore files and credentials are deliberately excluded from this source bundle.

Final verification: Gradle assembleRelease succeeded; apksigner verification passed and SHA-256 certificate equals original key; aapt package/version verified; zipalign 16KB check passed; all web assets byte-match the built APK.
APK SHA-256: 5b3240e604c311cbf5573ef87a82edf81b440030121b40f48aa49c8997e04a6e

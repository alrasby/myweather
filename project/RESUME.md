# Resume — MyWeather 1.0.47 / versionCode 48

Package: net.nabdhserv.myweather. Base recovered from delivered 1.0.46 source, preserving its wind/precipitation and icon fixes.

Implemented:
- Independent two-slot foreground/background HTTP lanes, cancellable queue, bounded timeouts/retries, native HTTP with genuine WebView fallback, Retry-After host cooldown.
- Main forecast no longer waits for air/marine endpoints. Forecast failure uses only real cached observations; no synthetic forecast. GPS/temporary place bundles survive cache writes. Failure/stale UI and automatic retry on reconnection/visibility and every 60s while visible.
- Unix forecast timestamps avoid DST ambiguity. Current temperature validated; 15 daily forecasts retained. Stale data includes source observation time.
- GPS coarse and fine fixes run together, retain best measured accuracy, await fine completion. Weather uses coordinates immediately before reverse geocoding. Exact coordinate place takes precedence over nearby saved cities. Location precision/failure shown.
- Regional map first; global grid deferred until wide view or regional failure. Persistent bounded IndexedDB grid cache (45min), preserving existing field rendering.

Files: src/weather/{net,api,store,geo,placeLookup,grid,gridCache}.ts; src/components/weather/{HomeScreen,WeatherApp,MapScreen}.tsx; capacitor.config.ts; android/app/build.gradle.

Verified: TypeScript; connection-tests.mjs (queue abort, quota cooldown, foreground isolation, forecast independence, timestamps/DST, real cached GPS data, failed no-cache rejection, best GPS); map-tests.mjs; precip-data-tests.mjs; render-tests.mjs (actual Canvas and wind movement); live-grid-test.mjs; worldwide-tests.mjs (Muscat, New York, London, Tokyo, Sydney with 15 days each). Adaptive icon alpha fits 66dp safe circle at every density; no grok folder.

Remaining limitation: no physical Android device or WebView execution in this environment. Device-specific DNS/mobile network cause cannot be established from screenshots. Temperatures are provider model values, not a guarantee of station-level accuracy or live radar coverage.

Build: npm run build:android BEFORE Gradle. Java21, SDK36, Gradle8.14.3. Original keystore excluded from source archive. Restore signing configuration privately when reproducing build. Final build/signature status recorded in BUILD_STATUS.md. Build and original-certificate verification passed; signed APK and source packaged for delivery.

Next: install signed 1.0.47 as update; test on Wi-Fi/mobile and precise location on the user's S25 Ultra, including reconnect after offline. If failure persists, collect endpoint/error status without publishing credentials or precise location.

# Android performance evidence — Build 64

One debug APK is built once with a strictly debug-only source-frame log, then installed into two Android API 34 x86_64 emulators with 1536 MB/2 cores and 3072 MB/4 cores. Repeat 3 cold Activity startups, 10 background/resumes, network down/up and source-backed ECMWF first complete-frame telemetry when available. Collect actual app process memory snapshots (PSS) and full logs. All raw data are GitHub Actions Artifacts.

These emulators model limited RAM/CPU but **are not physical devices**. Their battery stats cannot measure hardware energy or prove mAh/h savings. See the official Android Macrobenchmark PowerMetric physical Pixel hardware requirement. Physical low/mid Android power tests and paired cold/warm ECMWF before/after on the same phone/network remain mandatory for production. The user-provided first-complete baseline 8146.8 ms on a different physical device cannot be compared directly with emulator numbers.

Run same script on a physical device with Android debug bridge: bash project/scripts/device-perf-smoke.sh /path/to/qa-only-debug.apk physical-low or physical-medium. Use actual power profiler for battery and 5+ paired runs.

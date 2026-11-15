#!/usr/bin/env bash
set -euo pipefail
APK="$1"; CLASS="$2"; PACKAGE="net.nabdhserv.myweather"
OUT="device-perf-$CLASS"; mkdir -p "$OUT"
adb install -r "$APK" >"$OUT/install.log"
adb shell getprop ro.product.model >"$OUT/device.txt"
adb shell getprop ro.build.version.sdk >>"$OUT/device.txt"
adb shell wm size >>"$OUT/device.txt"
SIZE=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1)
WIDTH=$(echo "$SIZE" | cut -dx -f1)
HEIGHT=$(echo "$SIZE" | cut -dx -f2)
test "$WIDTH" -gt 100 && test "$HEIGHT" -gt 100
echo 'cycle,activity_start_ms,ecmwf_first_complete_ms,source_read_p95_ms,pss_total_kb,process_alive' >"$OUT/samples.csv"
for CYCLE in 1 2 3; do
  adb shell am force-stop "$PACKAGE" || true
  adb logcat -c || true
  adb shell am start -W -n "$PACKAGE/.MainActivity" >"$OUT/launch-$CYCLE.txt"
  START=$(grep 'TotalTime:' "$OUT/launch-$CYCLE.txt" | grep -oE '[0-9]+' | tail -1 || true)
  sleep 3
  adb shell input tap "$((WIDTH/2))" "$((HEIGHT-43))"
  sleep 4
  # The Map defaults to Temperature on a fresh install. Explicitly activate
  # Rain & snow (right-side third layer control) for ECMWF source timing.
  adb shell input tap "$((WIDTH-31))" "$((HEIGHT/2-4))"
  for T in $(seq 1 20); do
    sleep 2
    if adb logcat -d | grep -q MYWEATHER_ECMWF_PERF; then break; fi
  done
  adb logcat -d >"$OUT/logcat-$CYCLE.log"
  # Map icon center lies in the bottom ~48px on 320x640 test renders.
  # Do not mark ECMWF success until its source-ready log appears.
  adb shell dumpsys meminfo "$PACKAGE" >"$OUT/meminfo-$CYCLE.txt" || true
  adb shell screencap -p /sdcard/myweather-qa.png
  adb pull /sdcard/myweather-qa.png "$OUT/screenshot-$CYCLE.png" >/dev/null || true
  PSS=$(sed -n 's/^[[:space:]]*TOTAL PSS:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$OUT/meminfo-$CYCLE.txt" | head -1 || true)
  LINE=$(grep MYWEATHER_ECMWF_PERF "$OUT/logcat-$CYCLE.log" | tail -1 || true)
  export PROBE_JSON="$LINE"
  READS=$(python3 - <<'PY'
import os,json
try:
 d=json.loads(os.environ["PROBE_JSON"].split("MYWEATHER_ECMWF_PERF ",1)[1])
 print(str(d["startupMs"]["firstCompleteReady"])+","+str(d.get("sourceReadP95Ms","")))
except Exception: print(",")
PY
)
  ALIVE=0; if adb shell pidof "$PACKAGE" >/dev/null 2>&1; then ALIVE=1; fi
  echo "$CYCLE,$START,$READS,$PSS,$ALIVE" >>"$OUT/samples.csv"
  test "$ALIVE" -eq 1
done
for N in $(seq 1 10); do
  adb shell input keyevent KEYCODE_HOME
  sleep 1
  adb shell am start -n "$PACKAGE/.MainActivity" >/dev/null || true
  adb shell input tap "$((WIDTH/2))" "$((HEIGHT-43))" || true
done
adb shell dumpsys meminfo "$PACKAGE" >"$OUT/meminfo-after-10-resumes.txt" || true
adb shell svc wifi disable >"$OUT/network.txt" 2>&1 || true
adb shell svc data disable >>"$OUT/network.txt" 2>&1 || true
sleep 3
adb shell svc wifi enable >>"$OUT/network.txt" 2>&1 || true
adb shell svc data enable >>"$OUT/network.txt" 2>&1 || true
sleep 7
adb shell dumpsys meminfo "$PACKAGE" >"$OUT/meminfo-reconnected.txt" || true
adb shell dumpsys batterystats --charged "$PACKAGE" >"$OUT/emulator-batterystats-not-power.txt" || true
adb logcat -d >"$OUT/logcat-final.log" || true
echo "Emulator performance evidence (blank ECMWF means NOT MEASURED):"
cat "$OUT/samples.csv"
# Missing a source-verified ECMWF frame is an INCOMPLETE QA result, never
# a performance success. Validate all three model reads and memory samples.
python3 - "$OUT/samples.csv" <<'PY'
import csv,sys,statistics
with open(sys.argv[1],newline="") as handle:
    items=list(csv.DictReader(handle))
if len(items)!=3:raise SystemExit("QA incomplete: expected 3 map sessions")
for i,row in enumerate(items,1):
    if row["process_alive"]!="1":
        raise SystemExit(f"QA failed: app process terminated in cycle {i}")
    for name in ("ecmwf_first_complete_ms","source_read_p95_ms","pss_total_kb"):
        try: value=float(row[name])
        except (ValueError,TypeError):raise SystemExit(f"QA incomplete: {name} absent in cycle {i}")
        if value<=0:raise SystemExit(f"QA invalid: {name} in cycle {i}")
times=[float(x["ecmwf_first_complete_ms"]) for x in items]
print(f"ECMWF ready-frame samples: {times}; median={statistics.median(times):.1f}ms")
PY

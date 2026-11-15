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
# Exercise two map moves after the real ready-frame startup. The
# debug-only WebView probe records NEW viewport source, UTC time and true
# cloud/rain/snow coverage at 0.75/6/16 seconds. Keep exact map center and
# personal coordinates out of logcat. A startup frame cannot pass a later pan.
adb logcat -c || true
for LEG in 1 2; do
  Y="$((HEIGHT*55/100))"
  if [ "$LEG" -eq 1 ]; then
    X1="$((WIDTH*78/100))"; X2="$((WIDTH*23/100))"
  else
    X1="$((WIDTH*23/100))"; X2="$((WIDTH*78/100))"
  fi
  adb shell input swipe "$X1" "$Y" "$X2" "$Y" 700
  sleep 19
  adb shell screencap -p /sdcard/myweather-viewport.png
  adb pull /sdcard/myweather-viewport.png "$OUT/viewport-pan-$LEG.png" >/dev/null || true
done
# Explicit QA-only Leaflet zoom controls permit real low-memory emulator
# traversal across the wide-scale map. Discover the accessibility bounds
# rather than guessing display pixels or issuing synthetic model callbacks.
adb shell uiautomator dump /sdcard/myweather-accessibility.xml >"$OUT/zoom-uiautomator.txt" 2>&1 || true
adb shell cat /sdcard/myweather-accessibility.xml >"$OUT/zoom-accessibility.xml" 2>/dev/null || true
for MODE in out out in in; do
  POSITION=$(python3 - "$OUT/zoom-accessibility.xml" "$MODE" <<'PY'
import re,sys,xml.etree.ElementTree as ET
try:
  root=ET.parse(sys.argv[1]).getroot()
  target="zoom "+sys.argv[2]
  for node in root.iter("node"):
    a=node.attrib
    label=(a.get("content-desc","")+" "+a.get("text","")).lower()
    if target not in label:
      continue
    m=re.search(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",a.get("bounds",""))
    if m:
      x1,y1,x2,y2=map(int,m.groups())
      print(f"{(x1+x2)//2} {(y1+y2)//2}")
      break
except (ET.ParseError,OSError):pass
PY
)
  if [ -z "$POSITION" ]; then
    echo "Viewport QA incomplete: Leaflet debug Zoom $MODE unavailable in WebView accessibility tree" | tee "$OUT/zoom-verdict.txt"
    break
  fi
  read -r ZX ZY <<<"$POSITION"
  adb shell input tap "$ZX" "$ZY"
  sleep 19
  adb shell screencap -p /sdcard/myweather-zoom.png
  adb pull /sdcard/myweather-zoom.png "$OUT/viewport-zoom-$MODE-$(date +%s).png" >/dev/null || true
done
adb logcat -d >"$OUT/viewport-pan.log"
python3 - "$OUT/viewport-pan.log" "$OUT/viewport-pan-summary.json" <<'PY'
import json,sys
records=[]
for line in open(sys.argv[1],encoding="utf-8",errors="replace"):
    marker="MYWEATHER_ECMWF_VIEWPORT "
    if marker not in line:continue
    try: data=json.loads(line.split(marker,1)[1])
    except json.JSONDecodeError:continue
    records.append(data)
with open(sys.argv[2],"w",encoding="utf-8") as out:
    json.dump({"records":records,"verifiedNewViewport":any(
        rec.get("afterMs")==16000 and rec.get("verifiedComplete") is True
        for rec in records)},out,indent=2)
if len({r.get("generation") for r in records}) < 2:
    raise SystemExit("Viewport QA incomplete: no two distinct pan generations recorded")
# A zoom-out must obtain real coverage on a broad viewport AND recover
# after zooming back in. Old startup frames cannot pass this gate.
completeZooms=[r.get("mapZoom") for r in records if
    r.get("afterMs")==16000 and r.get("verifiedComplete") is True
    and isinstance(r.get("mapZoom"),(int,float))]
if not any(z<=4 for z in completeZooms) or not any(z>=5 for z in completeZooms):
    raise SystemExit("Viewport QA incomplete: zoom-out/in source-backed coverage not proven; inspect artifacts")
if not any(r.get("afterMs")==16000 and r.get("verifiedComplete") is True for r in records):
    raise SystemExit("Viewport QA incomplete: no genuinely complete new viewport after pan; inspect artifact")
for record in records:
    if record.get("verifiedComplete") and (
        record.get("source")!="spatial" or
        record.get("displayedFrame") is None or
        record.get("displayedValidTime") is None or
        record.get("sourceClockTextMatches") is not True
    ):
        raise SystemExit("Viewport QA invalid: source frame or *rendered* DOM clock mismatches model")
# A future next-hour image is legal only at the genuine end of a fully
# interpolated hour, certified by viewportQaSnapshot with EACH contributor's
# real tile coverage. Do not reject a real 18Z image at 17:59:55 just because
# the requested base hour remains 17Z.
if not any(r.get("afterMs")==16000 and r.get("verifiedComplete") and
           r.get("sourceClockTextMatches") is True for r in records):
    raise SystemExit("Viewport QA incomplete: true source + visible DOM clock never coincide")
print("Viewport pan and zoom: source-backed frames and visible clocks verified (emulator only)")
PY
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

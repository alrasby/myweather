import { Play, Sunrise, Sunset, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LayerGroup, Map as LeafletMap, TileLayer } from "leaflet";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { loadWeather, placeFromCoords } from "@/weather/api";
import { FieldEngine, type FrameInfo } from "@/weather/glField";
import { weatherLoadingPhase } from "@/weather/weatherPlayback";
import { covers, fetchGrid } from "@/weather/grid";
import { ModelField, type WeatherDiagnosticMode, type WeatherModelDiagnostics } from "@/weather/modelField";
import { inspectMapTilerCatalog, type MapTilerPilotCatalog } from "@/weather/maptilerPilot";

import { satelliteUnderlayZoom } from "@/weather/satelliteBasemap";
import { estimateGrid } from "@/weather/estimate";
import { formatClock, formatHour24, formatNumber, formatTemp, formatWind } from "@/weather/format";
import { convertWind } from "@/weather/format";
import { compassFrom } from "@/weather/heading";
import { layerByKind, legendTicks } from "@/weather/layers";
import { t, weatherKey } from "@/weather/i18n";
import { textBase } from "@/weather/locale";
import { lookupPlace } from "@/weather/placeLookup";
import { loadLiveCyclones, type LiveCyclone } from "@/weather/cyclones";
import { loadStormsOnce } from "@/weather/storms";
import { stormGradeKey, type PaintedSystem } from "@/weather/synoptic";
import { activePlace, useWeather } from "@/weather/store";
import type { FieldSample, GridField, Lang, Place, ShadeKind, WeatherBundle } from "@/weather/types";
import "leaflet/dist/leaflet.css";

type LeafletNs = typeof import("leaflet");

type SystemCard = {
  kind: PaintedSystem["kind"];
  name: string;
  rainMm: number;
  moveKmh: number;
  moveDir: number;
  windKmh: number;
};

type PopupState = {
  lat: number;
  lon: number;
  title: string;
  sample: FieldSample | null;
  loading: boolean;
  place: Place | null;
  temp: number | null;
  code: number | null;
  isDay: boolean;
  wind: number | null;
  timeZone: string | null;
  sunrise: number | null;
  sunset: number | null;
};

async function loadLeaflet(): Promise<LeafletNs> {
  const mod = await import("leaflet");
  const maybe = mod as LeafletNs & { default?: LeafletNs };
  return maybe.default ?? maybe;
}

function minZoomFor(el: HTMLElement): number {
  // At minimum zoom, never fit the entire world into the map viewport.
  // Keep at most half of the world's longitude visible, including landscape screens.
  const width = Math.max(1, el.clientWidth || 360);
  const z = Math.ceil(Math.log2((width * 2) / 256));
  return Math.min(16, Math.max(3, z));
}

type FetchBox = { south: number; north: number; west: number; lonSpan: number };

function wrapLon(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

/** نفس الإطار تقريبًا: لا نلغي طلبًا قائمًا فيُعلّق التحميل على الشبكة الخشنة. */
function sameFetch(a: FetchBox | null, b: FetchBox | null): boolean {
  if (!a || !b) return false;
  const span = Math.max(a.lonSpan, b.lonSpan, 1);
  if (Math.abs(a.lonSpan - b.lonSpan) / span > 0.18) return false;
  if (Math.abs((a.south + a.north) / 2 - (b.south + b.north) / 2) > span * 0.2) return false;
  if (Math.abs(wrapLon(a.west + a.lonSpan / 2 - (b.west + b.lonSpan / 2))) > span * 0.2) return false;
  return true;
}

export function MapScreen({ lang, active }: { lang: Lang; active: boolean }) {
  const places = useWeather((s) => s.places);
  const activeId = useWeather((s) => s.activeId);
  const prefs = useWeather((s) => s.prefs);
  const setPrefs = useWeather((s) => s.setPrefs);
  const bundle = useWeather((s) => s.bundle);
  const peek = useWeather((s) => s.peek);
  const place = activePlace({ places, activeId, peek });
  const hostRef = useRef<HTMLDivElement>(null);
  const imageryRef = useRef<TileLayer | null>(null);
  const modelRef = useRef<ModelField | null>(null);
  const rainFallbackRefreshRef = useRef<(() => void) | null>(null);
  const rainPlaybackQuickRef = useRef<(() => void) | null>(null);
  const rainFallbackSuspendRef = useRef<(() => void) | null>(null);
  if (!modelRef.current) modelRef.current = new ModelField();
  const engineRef = useRef<FieldEngine | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletNs | null>(null);
  const placeRef = useRef(place);
  const prefsRef = useRef(prefs);
  const langRef = useRef(lang);
  const tzRef = useRef(bundle?.timezone ?? "UTC");
  const bundleRef = useRef(bundle);
  const kindRef = useRef<ShadeKind>(0);
  const dragRef = useRef(false);
  const detailRef = useRef<GridField | null>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const clickTimer = useRef(0);
  const popupAbort = useRef<AbortController | null>(null);
  const openRef = useRef<(lat: number, lon: number) => void>(() => undefined);
  const openSystemRef = useRef<(hit: PaintedSystem) => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [weatherDiagnosticsOpen, setWeatherDiagnosticsOpen] = useState(false);
  const [weatherDiagnosticMode, setWeatherDiagnosticMode] = useState<WeatherDiagnosticMode>("all");
  const [weatherDiagnostics, setWeatherDiagnostics] = useState<WeatherModelDiagnostics | null>(null);
  const diagnosticsOpenRef = useRef(false);
  const diagnosticsTickRef = useRef(0);
  const rainTapRef = useRef({ count: 0, last: 0 });
  // Catalog-only experiment: isolated from the live weather map.
  // Key exists solely in transient input state and is cleared on submit.
  const [pilotKey, setPilotKey] = useState("");
  const [pilotResult, setPilotResult] = useState<MapTilerPilotCatalog | null>(null);
  const [pilotStatus, setPilotStatus] = useState("not-run");
  const [copyStatus, setCopyStatus] = useState("");
  const pilotRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => pilotRequestRef.current?.abort(), []);
  const checkPilot = () => {
    if (!pilotKey.trim() || pilotStatus === "loading") return;
    const key = pilotKey;
    setPilotKey("");
    pilotRequestRef.current?.abort();
    const ctrl = new AbortController();
    pilotRequestRef.current = ctrl;
    setPilotResult(null);
    setPilotStatus("loading");
    void inspectMapTilerCatalog(key, ctrl.signal)
      .then((catalog) => {
        if (ctrl.signal.aborted) return;
        setPilotResult(catalog);
        setPilotStatus("ok");
      })
      .catch((error: unknown) => {
        if (ctrl.signal.aborted) return;
        // Do not display URL, API key or provider response text.
        const reason = error instanceof Error ? error.message : "";
        setPilotStatus(/^maptiler-(?:http-\d{3}|catalog-invalid|key-missing-or-invalid)$/.test(reason) ? reason : "unavailable");
      });
  };
  diagnosticsOpenRef.current = weatherDiagnosticsOpen;
  const [kind, setKind] = useState<ShadeKind>(prefs.mapLayer);
  const [playing, setPlaying] = useState(false);
  const [weatherLoadPhase, setWeatherLoadPhase] = useState<0 | 1 | 2>(0);
  const weatherLoadPhaseRef = useRef<0 | 1 | 2>(0);
  const [progress, setProgress] = useState(0);
  const [pins, setPins] = useState<Array<LiveCyclone & { x: number; y: number }>>([]);
  const [cycloneMsg, setCycloneMsg] = useState<string | null>(null);
  const cycloneDismissed = useRef(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [system, setSystem] = useState<SystemCard | null>(null);
  placeRef.current = place;
  prefsRef.current = prefs;
  langRef.current = lang;
  tzRef.current = bundle?.timezone ?? tzRef.current;
  bundleRef.current = bundle;
  kindRef.current = kind;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false;
    let map: LeafletMap | null = null;
    const engine = new FieldEngine(el);
    // Only the rain/snow animation follows ECMWF frame readiness. The
    // wind and temperature playback paths remain unchanged.
    engine.canAdvanceRainTime = (timeMs) => modelRef.current?.canAdvanceTo(timeMs) ?? true;
    engineRef.current = engine;
    let lastRainLabelAt = 0;
    const paint = (info: FrameInfo) => {
      // Keep ECMWF prefetch, temporal blending and requested valid time
      // independent of the much slower text/DOM presentation workload.
      if (kindRef.current === 2) {
        modelRef.current?.setSourceBackedFallback(engine.hasSourceRain());
        modelRef.current?.setPlaybackActive(engine.playing);
        modelRef.current?.sync(info.timeMs);
        // While the next spatial hour decodes, fetch ONE lightweight genuine
        // world fallback only if the user is actively waiting for playback.
        if (engine.playing && info.playbackWaitingMs >= 1800) rainPlaybackQuickRef.current?.();
      }
      const now = performance.now();
      if (diagnosticsOpenRef.current && now - diagnosticsTickRef.current > 1000) {
        diagnosticsTickRef.current = now;
        setWeatherDiagnostics(modelRef.current?.diagnostics() ?? null);
      }
      // Avoid formatting the clock, searching nearby forecast points and
      // rewriting slider labels 60 times/second while large ECMWF raster
      // tiles are decoding on mobile. The model itself still updates above.
      if (kindRef.current === 2 && now - lastRainLabelAt < 180) return;
      lastRainLabelAt = now;
      // State changes only when the message phase changes, never at 60fps.
      // Skip brief cached-tile refreshes to keep the controls visually stable.
      const phase = kindRef.current === 2 ? weatherLoadingPhase(info.playbackWaitingMs) : 0;
      if (phase !== weatherLoadPhaseRef.current) {
        weatherLoadPhaseRef.current = phase;
        setWeatherLoadPhase(phase);
      }
      const current = prefsRef.current;
      const language = langRef.current;
      if (timeRef.current) {
        timeRef.current.textContent = formatClock(info.timeMs, tzRef.current, language);
      }
      if (valueRef.current) {
        if (kindRef.current === 2) {
          const center = mapRef.current?.getCenter();
          const near = center
            ? nearbyRain(placeRef.current, bundleRef.current, center.lat, center.lng, info.timeMs)
            : null;
          const gridMm = info.sample?.rain ?? 0;
          if (near != null && (info.estimated || (gridMm < 0.05 && near >= 0.05))) {
            valueRef.current.textContent = `${formatNumber(near, language, 1)} mm`;
          } else if (info.estimated) {
            valueRef.current.textContent = "—";
          } else {
            valueRef.current.textContent = info.sample ? sampleText(info.sample, 2, current, language) : "—";
          }
        } else {
          valueRef.current.textContent = info.sample
            ? sampleText(info.sample, kindRef.current, current, language)
            : "—";
        }
      }
      const grid = engine.activeGrid();
      if (sliderRef.current) {
        if (grid) sliderRef.current.max = String(Math.max(1, grid.hours - 1));
        if (!dragRef.current) sliderRef.current.value = String(info.hour);
      }
    };
    engine.onFrame = paint;
    const onVis = () => engine.setPaused(document.hidden || !el.offsetParent);
    document.addEventListener("visibilitychange", onVis);
    void (async () => {
      try {
        const L = await loadLeaflet();
        if (dead) return;
        leafletRef.current = L;
        map = L.map(el, {
          zoomControl: false,
          attributionControl: false,
          minZoom: minZoomFor(el),
          maxZoom: 16,
          zoomSnap: 1,
          // Restore pinch-to-zoom, anchored at map center to avoid dragging the
          // world out of its bounded viewport when two fingers move together.
          touchZoom: "center",
          bounceAtZoomLimits: false,
          zoomAnimation: true,
          // Android Chrome/WebView can expose horizontal tile compositing seams
          // while independently faded raster images are GPU-transformed.
          fadeAnimation: false,
          // Wrap longitudes continuously while constraining only the polar direction.
          worldCopyJump: true,
          inertia: true,
          // Cap long inertial flings to avoid moving ahead of available satellite tiles.
          inertiaDeceleration: 6800,
          inertiaMaxSpeed: 600,
          maxBounds: [[-85.0511287798, -100000], [85.0511287798, 100000]],
          maxBoundsViscosity: 1,
          doubleClickZoom: false,
        });
        const here = placeRef.current;
        map.setView([here.lat, here.lon], 5);
        const imageryUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
        // Keep a cheap, lower-resolution satellite backdrop while detailed tiles
        // are fetched after fast pans. Both layers use the same imagery provider.
        // At world zoom (<=5) the underlay and detailed imagery requested the
        // *same* Esri raster tiles and composited two full-size tile grids.
        // Avoid that duplicate GPU surface and its possible horizontal seams.
        // At closer zoom, the low-resolution underlay is useful while high-res
        // images arrive after a pan. Mount it only in that case.
        // At z=5 the previous backup was absent; after a long fling a tiny
        // island of old image tiles could remain against the empty field.
        // Keep ONE geographically correct, coarser Esri backup at a time.
        // Native z=4 only for z=5, native z=5 for closer zooms. Never mount
        // matching z=5 copies of the same satellite tiles.
        const underlay4 = L.tileLayer(imageryUrl, {
          maxNativeZoom: 4, maxZoom: 16, zIndex: 0,
          updateWhenIdle: false, updateInterval: 200, keepBuffer: 2,
        });
        const underlay5 = L.tileLayer(imageryUrl, {
          maxNativeZoom: 5, maxZoom: 16, zIndex: 0,
          updateWhenIdle: false, updateInterval: 200, keepBuffer: 2,
        });
        const syncUnderlay = () => {
          if (!map) return;
          const target = satelliteUnderlayZoom(map.getZoom());
          if (target !== 4 && map.hasLayer(underlay4)) map.removeLayer(underlay4);
          if (target !== 5 && map.hasLayer(underlay5)) map.removeLayer(underlay5);
          const needed = target === 4 ? underlay4 : target === 5 ? underlay5 : null;
          if (needed && !map.hasLayer(needed)) needed.addTo(map);
        };
        map.on("zoomend", syncUnderlay);
        syncUnderlay();
        const imagery = L.tileLayer(imageryUrl, {
          maxZoom: 16,
          zIndex: 1,
          updateWhenIdle: false,
          updateInterval: 150,
          keepBuffer: 3,
        }).addTo(map);
        imageryRef.current = imagery;
        const labels = map.createPane("wx-labels");
        labels.style.zIndex = "420";
        labels.style.pointerEvents = "none";
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 16, opacity: 0.92, pane: "wx-labels", updateWhenIdle: false, updateInterval: 150, keepBuffer: 3 },
        ).addTo(map);
        modelRef.current?.attach(L, map);
        if (modelRef.current) {
          // Show one coherent model at a time. The earlier permanent overlap
          // doubled precipitation colours and allowed coarse 72x36 fallback
          // cells to remain visible as rectangles over real ECMWF spatial tiles.
          // The global model is restored immediately when the spatial frame
          // is incomplete, unavailable, or fails to load.
          modelRef.current.onLive = () => {
            engine.setModelCover(true);
            rainFallbackSuspendRef.current?.();
          };
          modelRef.current.onMiss = () => {
            engine.setModelCover(false);
            rainFallbackRefreshRef.current?.();
          };
        }
        map.on("click", (event) => {
          window.clearTimeout(clickTimer.current);
          const hit = engine.hitTest(event.latlng.lat, event.latlng.lng);
          if (hit) {
            openSystemRef.current(hit);
            return;
          }
          const lat = event.latlng.lat;
          const lon = event.latlng.lng;
          clickTimer.current = window.setTimeout(() => openRef.current(lat, lon), 350);
        });
        mapRef.current = map;
        engine.attach(map);
        engine.setKind(kindRef.current);
        setReady(true);
      } catch {
        if (!dead) setReady(false);
      }
    })();
    return () => {
      dead = true;
      window.clearTimeout(clickTimer.current);
      popupAbort.current?.abort();
      document.removeEventListener("visibilitychange", onVis);
      // Weather model also owns Leaflet tile layers, metadata requests and
      // per-frame retry timers; release it before map and GL contexts.
      modelRef.current?.dispose();
      engine.destroy();
      map?.remove();
      engineRef.current = null;
      mapRef.current = null;
    };
    // الخريطة تُنشأ مرة واحدة؛ المدينة اللاحقة تُتابَع بتأثير منفصل.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const engine = engineRef.current;
    if (!map || !engine || !ready) return;
    if (!active) {
      engine.setPaused(true);
      return;
    }
    engine.setPaused(document.hidden);
    // Refresh the container without an implicit pan/jump after tab activation.
    map.invalidateSize({ pan: false, debounceMoveend: true });
    engine.resize();
  }, [active, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.flyTo([place.lat, place.lon], Math.max(map.getZoom(), 6), { duration: 0.7 });
  }, [place.id, ready]);

  useEffect(() => {
    modelRef.current?.setDiagnosticMode(weatherDiagnosticsOpen ? weatherDiagnosticMode : "all");
  }, [weatherDiagnosticsOpen, weatherDiagnosticMode]);

  useEffect(() => {
    engineRef.current?.setKind(kind);
    imageryRef.current?.setOpacity(1);
    modelRef.current?.setVisible(kind === 2);
    if (kind !== 2) engineRef.current?.setModelCover(false);
  }, [kind, ready]);

  useEffect(() => {
    setKind(prefs.mapLayer);
  }, [prefs.mapLayer]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    const n = prefs.dataSaver ? 0 : prefs.particles === "high" ? 360 : prefs.particles === "med" ? 300 : 240;
    engine.setParticleCount(n);
    engine.setSaver(prefs.dataSaver);
  }, [prefs.dataSaver, prefs.particles, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const engine = engineRef.current;
    if (!map || !engine || !ready) return;
    let dead = false;
    let timer = 0;
    let detailGen = 0;
    let worldReady = false;
    const worldAc = new AbortController();
    let detailAc: AbortController | null = null;
    let pendingDetail: FetchBox | null = null;
    detailRef.current = null;
    engine.setDetail(null);
    const hours = prefs.mapHours === 72 ? 48 : prefs.mapHours;
    const saver = prefs.dataSaver;
    setProgress(0.08);
    const world = { south: -80, north: 84, west: -180, lonSpan: 360, hours, full: true as const };
    engine.setGlobal(estimateGrid({ ...world, cols: saver ? 12 : 24, rows: saver ? 6 : 12 }));

    const viewSpan = () => {
      const size = map.getSize();
      const nw = map.containerPointToLatLng([0, 0]);
      const se = map.containerPointToLatLng([size.x, size.y]);
      let west = nw.lng;
      let east = se.lng;
      if (east < west) east += 360;
      return { south: se.lat, north: nw.lat, west, east, span: east - west };
    };

    const loadWorld = (cols: number, rows: number, from: number, to: number) =>
      fetchGrid({
        ...world,
        cols,
        rows,
        signal: worldAc.signal,
        onProgress: (done, total) => {
          if (!dead) setProgress(Math.min(to, from + (done / Math.max(1, total)) * (to - from)));
        },
      });

    const pullDetail = () => {
      if (!worldReady || saver || dead) return;
      const view = viewSpan();
      if (view.span > 165) {
        detailGen += 1;
        detailAc?.abort();
        detailAc = null;
        pendingDetail = null;
        detailRef.current = null;
        engine.setDetail(null);
        return;
      }
      if (view.span < 1.2) return;
      const span = view.span;
      const padLon = Math.max(1.5, span * 0.35);
      const padLat = Math.max(1.2, (view.north - view.south) * 0.35);
      const south = Math.max(-85, view.south - padLat);
      const north = Math.min(85, view.north + padLat);
      const west = view.west - padLon;
      const lonSpan = Math.max(6, view.east + padLon - west);
      const nextBox: FetchBox = { south, north, west, lonSpan };
      if (sameFetch(pendingDetail, nextBox)) return;
      const loaded = detailRef.current;
      if (loaded && covers(loaded, view)) {
        const have = loaded.lonSpan / Math.max(1, loaded.cols);
        const want = Math.max(0.55, Math.min(2.2, span / 42));
        if (have <= want * 1.35) return;
      }
      const mine = ++detailGen;
      pendingDetail = nextBox;
      detailAc?.abort();
      detailAc = new AbortController();
      const latH = Math.max(1, north - south);
      const area = Math.max(6, lonSpan * latH);
      let cell = Math.sqrt(area / 1400);
      cell = Math.max(0.55, Math.min(2.2, cell));
      let cols = Math.max(18, Math.min(56, Math.round(lonSpan / cell)));
      let rows = Math.max(14, Math.min(36, Math.round(latH / cell)));
      while (cols * rows > 1400 && (cols > 18 || rows > 14)) {
        if (cols >= rows && cols > 18) cols -= 1;
        else if (rows > 14) rows -= 1;
        else break;
      }
      void fetchGrid({
        south,
        north,
        west,
        lonSpan,
        cols,
        rows,
        hours,
        full: false,
        signal: detailAc.signal,
      })
        .then((grid) => {
          if (dead || mine !== detailGen) return;
          const now = viewSpan();
          if (now.span > 165 || !covers(grid, now)) return;
          detailRef.current = grid;
          engine.setDetail(grid);
        })
        .catch(() => {
          if (mine === detailGen) pendingDetail = null;
        });
    };
    const consider = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(pullDetail, 320);
    };
    map.on("moveend", consider);
    map.on("zoomend", consider);
    void (async () => {
      try {
        const quick = await loadWorld(saver ? 12 : 24, saver ? 6 : 12, 0.05, 0.32);
        if (dead) return;
        engine.setGlobal(quick);
        worldReady = true;
        if (saver) {
          setProgress(1);
          return;
        }
        consider();
        const fine = await loadWorld(48, 24, 0.32, 0.98);
        if (dead) return;
        engine.setGlobal(fine);
        setProgress(1);
      } catch {
        if (!dead && !worldAc.signal.aborted) {
          if (!worldReady) {
            engine.setGlobal(estimateGrid({ ...world, cols: saver ? 12 : 24, rows: saver ? 6 : 12 }));
          }
          setProgress(1);
        }
      }
    })();
    return () => {
      dead = true;
      worldAc.abort();
      detailAc?.abort();
      window.clearTimeout(timer);
      map.off("moveend", consider);
      map.off("zoomend", consider);
    };
  }, [ready, prefs.mapHours, prefs.dataSaver]);

  useEffect(() => {
    const map = mapRef.current;
    const engine = engineRef.current;
    if (!map || !engine || !ready || kind !== 2) return;
    let dead = false;
    let timer = 0;
    let viewGen = 0;
    const worldAc = new AbortController();
    let viewAc: AbortController | null = null;
    let pendingView: FetchBox | null = null;
    let loadedView: Awaited<ReturnType<typeof fetchGrid>> | null = null;
    let fineWorldAc: AbortController | null = null;
    let fineWorldPending = false;
    let fineWorldLoaded = false;
    let quickWorldReady = false;
    let quickWorldPending = false;
    let detailAllowed = false;
    let fallbackTimer = 0;
    const hours = prefs.mapHours === 72 ? 48 : prefs.mapHours;
    const saver = prefs.dataSaver;

    const loadWorld = async () => {
      const box = {
        south: -80,
        north: 84,
        west: -180,
        lonSpan: 360,
        hours,
        full: true as const,
        dryRain: true,
        signal: worldAc.signal,
      };
      try {
        const quick = await fetchGrid({ ...box, cols: saver ? 18 : 36, rows: saver ? 10 : 18 });
        if (dead) return;
        engine.setRainWorld(quick);
        quickWorldReady = true;
        // Fine fallback work is scheduled only if ECMWF remains unavailable.
        // Starting 72x36 global + 4200-point regional fetches alongside
        // heavy ECMWF WASM workers was wasting bandwidth and CPU on imagery
        // hidden behind an already-complete model layer.
      } catch {
        // Do not enter an endless timer loop when the quick fallback fails.
        // The existing generic weather field still remains available.
        quickWorldReady = true;
      }
    };

    const pullView = () => {
      if (saver || dead || !detailAllowed) return;
      // A complete ECMWF model already supplies high-resolution on-screen
      // rain/snow/cloud imagery. Avoid competing Open-Meteo regional requests
      // whenever the user pans the map while that imagery is visible.
      if (modelRef.current?.isSpatialVisible()) {
        viewGen += 1;
        viewAc?.abort();
        viewAc = null;
        pendingView = null;
        return;
      }
      const size = map.getSize();
      const nw = map.containerPointToLatLng([0, 0]);
      const se = map.containerPointToLatLng([size.x, size.y]);
      let west = nw.lng;
      let east = se.lng;
      if (east < west) east += 360;
      const span = Math.min(360, east - west);
      if (span > 200) {
        viewGen += 1;
        viewAc?.abort();
        viewAc = null;
        pendingView = null;
        // Keep the last regional rain texture cached while zooming out.
        // The renderer already falls back to the world grid when it no longer covers the view.
        return;
      }
      if (span < 1.2) return;
      const latSpan = Math.max(1, nw.lat - se.lat);
      const wide = span > 36;
      const padFrac = wide ? 0.12 : 0.28;
      const padLon = Math.max(wide ? 1.4 : 1.8, span * padFrac);
      const padLat = Math.max(wide ? 1 : 1.2, latSpan * padFrac);
      const south = Math.max(-80, se.lat - padLat);
      const north = Math.min(84, nw.lat + padLat);
      const boxWest = west - padLon;
      const lonSpan = Math.max(6, east + padLon - boxWest);
      const nextBox: FetchBox = { south, north, west: boxWest, lonSpan };
      // Reuse a loaded rain grid while its padded coverage and resolution remain sufficient.
      // Avoid aborting/restarting expensive precipitation requests on every small pan.
      if (loadedView &&
          covers(loadedView, { south, north, west: boxWest, east: boxWest + lonSpan }) &&
          loadedView.lonSpan / Math.max(1, loadedView.cols) <= Math.max(0.4, Math.min(1.7, Math.sqrt(Math.max(6, lonSpan * Math.max(1, north - south)) / 4200))) * 1.25) return;
      if (sameFetch(pendingView, nextBox)) return;
      const viewLat = Math.max(1, north - south);
      const budget = 4200;
      const area = Math.max(6, lonSpan * viewLat);
      let cell = Math.sqrt(area / budget);
      cell = Math.max(0.4, Math.min(1.7, cell));
      let cols = Math.max(20, Math.min(84, Math.round(lonSpan / cell)));
      let rows = Math.max(14, Math.min(60, Math.round(viewLat / cell)));
      while (cols * rows > budget && (cols > 20 || rows > 14)) {
        if (cols >= rows && cols > 20) cols -= 1;
        else if (rows > 14) rows -= 1;
        else break;
      }
      const midCols = Math.max(16, Math.round(cols * 0.62));
      const midRows = Math.max(12, Math.round(rows * 0.62));
      const mine = ++viewGen;
      pendingView = nextBox;
      viewAc?.abort();
      viewAc = new AbortController();
      const signal = viewAc.signal;
      const box = {
        south,
        north,
        west: boxWest,
        lonSpan,
        hours,
        full: false as const,
        dryRain: true,
        signal,
      };
      const show = (grid: Awaited<ReturnType<typeof fetchGrid>>) => {
        if (dead || signal.aborted || mine !== viewGen) return;
        const sizeNow = map.getSize();
        const nwNow = map.containerPointToLatLng([0, 0]);
        const seNow = map.containerPointToLatLng([sizeNow.x, sizeNow.y]);
        let westNow = nwNow.lng;
        let eastNow = seNow.lng;
        if (eastNow < westNow) eastNow += 360;
        if (Math.min(360, eastNow - westNow) > 200) return;
        if (!covers(grid, { south: seNow.lat, north: nwNow.lat, west: westNow, east: eastNow })) return;
        loadedView = grid;
        engine.setRainView(grid);
      };
      void (async () => {
        try {
          const mid = await fetchGrid({ ...box, cols: midCols, rows: midRows });
          show(mid);
          const fine = await fetchGrid({ ...box, cols, rows });
          show(fine);
        } catch {
          if (mine === viewGen) pendingView = null;
        }
      })();
    };

    // Schedule expensive fallback only if the spatial model has failed to
    // provide coverage for a sustained interval. The quick world fallback is
    // always fetched immediately, so the app is not blank while waiting.
    const loadFineFallback = () => {
      if (dead || saver || modelRef.current?.isSpatialVisible() ||
          fineWorldLoaded || fineWorldPending) return;
      fineWorldPending = true;
      const controller = new AbortController();
      fineWorldAc = controller;
      void fetchGrid({
        south: -80, north: 84, west: -180, lonSpan: 360, hours,
        full: true, dryRain: true, signal: controller.signal,
        cols: 72, rows: 36,
      }).then((grid) => {
        if (dead || controller.signal.aborted) return;
        fineWorldLoaded = true;
        engine.setRainWorld(grid);
      }).catch(() => {
        // Keep the already loaded quick world fallback available.
      }).finally(() => {
        if (fineWorldAc === controller) {
          fineWorldAc = null;
          fineWorldPending = false;
        }
      });
    };
    const enableDetailedFallback = () => {
      if (dead || saver || modelRef.current?.isSpatialVisible()) return;
      if (!quickWorldReady) {
        // The generic global grid is already available. Do not start the
        // second worldwide rain-grid request concurrently with ECMWF cloud
        // decoding; only fetch it after a sustained spatial-model outage.
        if (!quickWorldPending) {
          quickWorldPending = true;
          void loadWorld().finally(() => { quickWorldPending = false; });
        }
        fallbackTimer = window.setTimeout(enableDetailedFallback, 1000);
        return;
      }
      detailAllowed = true;
      loadFineFallback();
      pullView();
    };
    const scheduleDetailedFallback = () => {
      if (dead || saver || detailAllowed || fallbackTimer ||
          modelRef.current?.isSpatialVisible()) return;
      // Short intermittent ECMWF misses during an animation should not
      // trigger another expensive pointwise API workload.
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = 0;
        enableDetailedFallback();
      }, 4500);
    };
    const suspendDetailedFallback = () => {
      if (!detailAllowed && !fallbackTimer && !viewAc && !fineWorldAc) return;
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
      detailAllowed = false;
      viewGen += 1;
      viewAc?.abort();
      viewAc = null;
      pendingView = null;
      fineWorldAc?.abort();
      fineWorldAc = null;
      fineWorldPending = false;
      // A completed fallback stays in memory for future ECMWF outages.
    };
    rainFallbackRefreshRef.current = scheduleDetailedFallback;
    rainFallbackSuspendRef.current = suspendDetailedFallback;
    const preparePlaybackFallback = () => {
      if (dead || saver || quickWorldReady || quickWorldPending) return;
      quickWorldPending = true;
      void loadWorld().finally(() => { quickWorldPending = false; });
    };
    rainPlaybackQuickRef.current = preparePlaybackFallback;

    // Initially prioritize three actual ECMWF spatial layers. The
    // existing generic grid covers the fallback until a sustained outage.
    scheduleDetailedFallback();
    const consider = () => {
      if (dead) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(pullView, 280);
    };
    map.on("moveend", consider);
    map.on("zoomend", consider);
    return () => {
      dead = true;
      if (rainFallbackRefreshRef.current === scheduleDetailedFallback) rainFallbackRefreshRef.current = null;
      if (rainPlaybackQuickRef.current === preparePlaybackFallback) rainPlaybackQuickRef.current = null;
      if (rainFallbackSuspendRef.current === suspendDetailedFallback) rainFallbackSuspendRef.current = null;
      worldAc.abort();
      fineWorldAc?.abort();
      viewAc?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(fallbackTimer);
      map.off("moveend", consider);
      map.off("zoomend", consider);
    };
  }, [ready, kind, prefs.mapHours, prefs.dataSaver]);

  useEffect(() => {
    engineRef.current?.setOverlay(lang, prefs.wind);
  }, [lang, prefs.wind, ready]);

  useEffect(() => {
    engineRef.current?.setShowCyclones(prefs.storms);
  }, [prefs.storms, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!prefs.storms) {
      engineRef.current?.setCyclones([]);
      setPins([]);
      cycloneDismissed.current = false;
      setCycloneMsg(null);
      return;
    }
    let dead = false;
    let raf = 0;
    let timer = 0;
    const storms: LiveCyclone[] = [];
    const place = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (dead) return;
        const size = map.getSize();
        const next = storms.flatMap((storm) => {
          const p = map.latLngToContainerPoint([storm.lat, storm.lon]);
          if (p.x < -40 || p.y < -40 || p.x > size.x + 40 || p.y > size.y + 40) return [];
          return [{ ...storm, x: p.x, y: p.y }];
        });
        setPins((prev) => {
          if (
            prev.length === next.length &&
            prev.every((pin, i) => pin.id === next[i]?.id && Math.abs(pin.x - (next[i]?.x ?? 0)) < 0.5 && Math.abs(pin.y - (next[i]?.y ?? 0)) < 0.5)
          ) {
            return prev;
          }
          return next;
        });
      });
    };
    const apply = (loaded: { storms: LiveCyclone[]; ok: boolean }) => {
      if (dead) return;
      const list = loaded.storms;
      storms.splice(0, storms.length, ...list);
      engineRef.current?.setCyclones(list);
      engineRef.current?.setShowCyclones(true);
      if (list.length) {
        cycloneDismissed.current = false;
        setCycloneMsg(null);
      } else if (!cycloneDismissed.current) {
        setCycloneMsg(t(lang, loaded.ok ? "cycloneNone" : "cycloneFail"));
      }
      place();
    };
    void loadLiveCyclones().then(apply);
    timer = window.setInterval(() => {
      void loadLiveCyclones().then(apply);
    }, 60_000);
    map.on("move zoom resize", place);
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(timer);
      map.off("move zoom resize", place);
    };
  }, [ready, prefs.storms, lang]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || !ready) return;
    let dead = false;
    let group: LayerGroup | null = null;
    if (!prefs.storms) return;
    if (!map.getPane("wx-storms")) {
      const pane = map.createPane("wx-storms");
      pane.style.zIndex = "470";
      pane.style.pointerEvents = "none";
    }
    void loadStormsOnce().then((pack) => {
      if (dead || !pack) return;
      group = L.layerGroup();
      const cone = L.geoJSON(pack.cone as never, {
        pane: "wx-storms",
        style: () => ({ color: "#f2d48a", weight: 1, fillColor: "#f2d48a", fillOpacity: 0.16 }),
      });
      const past = L.geoJSON(pack.past as never, {
        pane: "wx-storms",
        style: () => ({ color: "#f7f9fb", weight: 2, opacity: 0.9 }),
      });
      const future = L.geoJSON(pack.future as never, {
        pane: "wx-storms",
        style: () => ({ color: "#e2b340", weight: 2.5, opacity: 0.95 }),
      });
      group.addLayer(cone);
      group.addLayer(past);
      group.addLayer(future);
      group.addTo(map);
    });
    return () => {
      dead = true;
      group?.remove();
    };
  }, [prefs.storms, ready]);

  const openAt = (lat: number, lon: number) => {
    setSystem(null);
    popupAbort.current?.abort();
    const ac = new AbortController();
    popupAbort.current = ac;
    const sample = engineRef.current?.sampleAt(lat, lon) ?? null;
    setPopup({
      lat,
      lon,
      title: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      sample,
      loading: true,
      place: null,
      temp: sample?.temp ?? null,
      code: null,
      isDay: true,
      wind: sample?.spd ?? null,
      timeZone: null,
      sunrise: null,
      sunset: null,
    });
    void (async () => {
      const rev = await lookupPlace(lat, lon, textBase());
      if (ac.signal.aborted) return;
      const title = rev?.name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
      const next = placeFromCoords(lat, lon, title, rev?.country || "", rev?.admin || "");
      setPopup((cur) => (cur ? { ...cur, title, place: next } : cur));
      try {
        const loaded = await loadWeather(next, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setPopup((cur) =>
          cur
            ? {
                ...cur,
                loading: false,
                temp: loaded.bundle.current.temp,
                code: loaded.bundle.current.code,
                isDay: loaded.bundle.current.isDay,
                wind: loaded.bundle.current.wind,
                timeZone: loaded.bundle.timezone,
                sunrise: loaded.bundle.daily[0]?.sunrise ?? null,
                sunset: loaded.bundle.daily[0]?.sunset ?? null,
              }
            : cur,
        );
      } catch {
        if (!ac.signal.aborted) setPopup((cur) => (cur ? { ...cur, loading: false } : cur));
      }
    })();
  };
  openRef.current = openAt;
  const openSystem = (hit: PaintedSystem) => {
    popupAbort.current?.abort();
    const sample = engineRef.current?.sampleAt(hit.lat, hit.lon);
    setPopup(null);
    setSystem({
      kind: hit.kind,
      name: hit.name,
      rainMm: sample?.rain ?? 0,
      moveKmh: hit.moveKmh,
      moveDir: hit.moveDir,
      windKmh: hit.windKmh,
    });
  };
  openSystemRef.current = openSystem;

  const layer = layerByKind(kind);
  const ticks = legendTicks(layer);
  const gradient = `linear-gradient(to right, ${layer.stops
    .map((stop) => {
      const pct = ((stop.v - layer.range[0]) / (layer.range[1] - layer.range[0] || 1)) * 100;
      return `${stop.hex} ${pct}%`;
    })
    .join(", ")})`;

  return (
    <div className="map-stage relative h-full min-h-0 w-full">
      <div ref={hostRef} dir="ltr" className="map-host absolute inset-0" style={{ background: "#101820" }} />
      <div className="cyclone-layer" dir="ltr">
        {cycloneMsg ? (
          <button
            type="button"
            className="cyclone-note"
            onClick={() => {
              cycloneDismissed.current = true;
              setCycloneMsg(null);
            }}
          >
            <span>{cycloneMsg}</span>
            <X className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">{t(lang, "close")}</span>
          </button>
        ) : null}
        {pins.map((storm) => (
            <button
              key={storm.id}
              type="button"
              className="cyclone-pin"
              style={{ left: storm.x, top: storm.y }}
              onClick={(event) => {
                event.stopPropagation();
                openSystem({
                  kind: "cyclone",
                  name: storm.name,
                  lat: storm.lat,
                  lon: storm.lon,
                  pts: storm.track,
                  moveKmh: storm.moveKmh,
                  moveDir: storm.moveDir,
                  windKmh: storm.windKmh,
                });
              }}
            >
              <CycloneGlyph />
              <b>{storm.name}</b>
            </button>
        ))}
      </div>
      <div className="map-tools">
        {(
          [
            [0, WindMark, "windLayer"],
            [1, ThermoMark, "tempLayer"],
            [2, RainMark, "rainLayer"],
          ] as const
        ).map(([id, Icon, key]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              // The visible information button is the reliable primary entry.
              // Retain the previous multi-tap shortcut as an alternative.
              if (id === 2 && kindRef.current === 2) {
                const now = Date.now();
                const previous = rainTapRef.current;
                const count = now - previous.last < 2400 ? previous.count + 1 : 1;
                rainTapRef.current = { count, last: now };
                if (count >= 3) {
                  setWeatherDiagnosticsOpen((open) => !open);
                  rainTapRef.current = { count: 0, last: 0 };
                }
              } else {
                rainTapRef.current = { count: 0, last: 0 };
              }
              setKind(id);
              setPrefs({ mapLayer: id });
            }}
            className="map-tool"
            aria-pressed={kind === id}
            aria-label={t(lang, key)}
          >
            <Icon />
          </button>
        ))}
        {/* Diagnostics remain available via three taps on the rain layer button;
            do not show a permanent ⓘ control on the public map. */}
        <button type="button" className="map-tool map-tool-gap" onClick={() => mapRef.current?.zoomIn()} aria-label="+">
          <PlusMark />
        </button>
        <button type="button" className="map-tool" onClick={() => mapRef.current?.zoomOut()} aria-label="-">
          <MinusMark />
        </button>
      </div>
      {weatherDiagnosticsOpen && kind === 2 ? (
        <div dir={lang === "ar" ? "rtl" : "ltr"} className="pointer-events-auto absolute left-3 top-16 z-[600] max-w-[min(92vw,340px)] rounded-xl bg-slate-950/90 p-3 text-xs text-white shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-4">
            <strong>{lang === "ar" ? "تشخيص طبقات الطقس" : "Weather layer diagnostics"}</strong>
            <button type="button" className="rounded px-2 py-1 text-white" onClick={() => setWeatherDiagnosticsOpen(false)} aria-label={lang === "ar" ? "إغلاق التشخيص" : "Close diagnostics"}>✕</button>
          </div>
          <div className="mb-2 flex flex-wrap gap-1">
            {([
              ["all", lang === "ar" ? "الكل" : "All"],
              ["cloud", lang === "ar" ? "الغيوم" : "Clouds"],
              ["rain", lang === "ar" ? "المطر" : "Rain"],
              ["snow", lang === "ar" ? "الثلج" : "Snow"],
              ["fallback", lang === "ar" ? "الاحتياطي" : "Fallback"],
            ] as const).map(([mode, title]) => (
              <button key={mode} type="button" className={`rounded border px-2 py-1 ${weatherDiagnosticMode === mode ? "border-white bg-white/25" : "border-white/30"}`} onClick={() => setWeatherDiagnosticMode(mode)}>
                {title}
              </button>
            ))}
          </div>
          <p>{lang === "ar" ? "المصدر المعروض" : "Displayed source"}: {weatherDiagnostics?.source === "spatial" ? "ECMWF spatial" : "Open-Meteo fallback"}</p>
          <p>{lang === "ar" ? "بيانات النموذج" : "Model metadata"}: {weatherDiagnostics?.metadataAvailable ? "OK" : "unavailable"}</p>
          <p>{lang === "ar" ? "إصدار ECMWF الثابت" : "Pinned ECMWF model run"}: {weatherDiagnostics?.modelRunPinned ? "OK" : "capture fallback"}
            {weatherDiagnostics?.modelRunReferenceTime ? ` · ${weatherDiagnostics.modelRunReferenceTime}` : ""}
          </p>
          <button type="button" className="my-1 rounded border border-white/35 px-2 py-1"
            onClick={() => {
              const report = modelRef.current?.diagnostics();
              if (!report || !navigator.clipboard?.writeText) {
                setCopyStatus(lang === "ar" ? "النسخ غير متاح" : "Clipboard unavailable");
                return;
              }
              void navigator.clipboard.writeText(JSON.stringify({
                capturedAt: new Date().toISOString(),
                layer: "ECMWF rain/cloud/snow",
                dataSaver: prefs.dataSaver,
                ...report,
              }, null, 2)).then(
                () => setCopyStatus(lang === "ar" ? "تم نسخ القياسات" : "Metrics copied"),
                () => setCopyStatus(lang === "ar" ? "تعذر النسخ" : "Copy failed"),
              );
            }}>
            {lang === "ar" ? "نسخ تقرير الأداء الفعلي" : "Copy actual performance report"}
          </button>
          {copyStatus ? <p role="status">{copyStatus}</p> : null}
          <p>{lang === "ar" ? "استعلامات حجم الملف المشتركة" : "Shared size probes"}: {weatherDiagnostics?.sharedFileProbes ?? 0}
            {" · "}{lang === "ar" ? "استعلامات نشطة" : "active"}: {weatherDiagnostics?.activeFileProbes ?? 0}
          </p>
          <p>{lang === "ar" ? "تجديد نافذة فك بيانات OM" : "Spatial window updates"}: {weatherDiagnostics?.spatialWindowUpdates ?? 0}
            {" · "}{lang === "ar" ? "إعادة الاستخدام" : "reused"}: {weatherDiagnostics?.spatialWindowReuses ?? 0}
            {" · "}{lang === "ar" ? "حركة الخريطة" : "gesture"}: {weatherDiagnostics?.gestureActive ? "yes" : "no"}
          </p>
          <p>{lang === "ar" ? "طلبات الشبكة" : "Native reads"}: {weatherDiagnostics?.nativeReads ?? 0}
            {" · "}{lang === "ar" ? "من الذاكرة" : "cache hits"}: {weatherDiagnostics?.cacheHits ?? 0}
          </p>
          <p>{lang === "ar" ? "طلبات مشتركة دون تكرار" : "Shared in-flight reads"}: {weatherDiagnostics?.sharedRangeReads ?? 0}
            {" · "}{lang === "ar" ? "طلبات نشطة" : "active ranges"}: {weatherDiagnostics?.activeSharedRanges ?? 0}
          </p>
          <p>{lang === "ar" ? "طلبات مؤهلة للتخزين" : "Cache-eligible misses"}: {weatherDiagnostics?.cacheEligible ?? 0}
            {" · "}{lang === "ar" ? "حُفظت" : "stored"}: {weatherDiagnostics?.cacheStored ?? 0}
            {" · "}{lang === "ar" ? "غير قابلة للتخزين" : "rejected"}: {weatherDiagnostics?.cacheRejected ?? 0}
          </p>
          <p>{lang === "ar" ? "الإطار المطلوب" : "Requested frame"}: {weatherDiagnostics?.requestedFrame ?? "—"}</p>
          <p>{lang === "ar" ? "الإطار المعروض فعليًا" : "Displayed frame"}: {weatherDiagnostics?.displayedFrame ?? "—"}
            {weatherDiagnostics?.holdingPreviousFrame ? (lang === "ar" ? " · الاحتفاظ بالإطار السابق" : " · holding previous frame") : ""}
          </p>
          <p>{lang === "ar" ? "وقت النموذج المطلوب" : "Requested model time"}: {weatherDiagnostics?.requestedValidTime ?? "—"}</p>
          <p>{lang === "ar" ? "وقت النموذج المعروض" : "Displayed model time"}: {weatherDiagnostics?.displayedValidTime ?? "—"}</p>
          {weatherDiagnostics?.error ? (
            <p className="my-1 break-words text-amber-200" role="status">
              {lang === "ar" ? "الخطأ" : "Error"}: {weatherDiagnostics.error}
            </p>
          ) : null}
          <div className="my-1 rounded-md border border-white/15 bg-white/5 p-1.5 text-[0.66rem] leading-relaxed">
            <p>{lang === "ar" ? "قياس أداء ECMWF (آخر 120 طلبًا/بلاطة)" : "ECMWF performance (last 120 samples)"}</p>
            {(["nativeQueue", "nativeNetwork"] as const).map((key) => (
              <p key={key}>{key === "nativeQueue"
                  ? (lang === "ar" ? "انتظار الشبكة" : "Native queue wait")
                  : (lang === "ar" ? "نقل الشبكة" : "Native transport")}:
                {" p50 "}{weatherDiagnostics?.performance[key].p50Ms?.toFixed(0) ?? "—"}
                {" ms · p95 "}{weatherDiagnostics?.performance[key].p95Ms?.toFixed(0) ?? "—"}{" ms"}
                {" · n="}{weatherDiagnostics?.performance[key].count ?? 0}
              </p>
            ))}
            {(["cloud", "rain", "snow"] as const).map((layer, i) => (
              <p key={layer}>{layer} {"tile total p50 "}
                {weatherDiagnostics?.performance.tilePipeline[i]?.p50Ms?.toFixed(0) ?? "—"}
                {" ms · p95 "}
                {weatherDiagnostics?.performance.tilePipeline[i]?.p95Ms?.toFixed(0) ?? "—"}
                {" ms"}
                {" · n="}{weatherDiagnostics?.performance.tilePipeline[i]?.count ?? 0}
              </p>
            ))}
            <p>{lang === "ar" ? "زمن تهيئة النموذج" : "Model startup"}: 
              {" metadata "}{weatherDiagnostics?.startupMs.metadata?.toFixed(0) ?? "—"}{"ms"}
              {" · "}{lang === "ar" ? "أول غيوم جاهزة" : "first clouds ready"}{" "}{weatherDiagnostics?.startupMs.firstCloudReady?.toFixed(0) ?? "—"}{"ms"}
              {" · "}{lang === "ar" ? "أول إطار مكتمل" : "first complete frame"}{" "}{weatherDiagnostics?.startupMs.firstCompleteReady?.toFixed(0) ?? "—"}{"ms"}
            </p>
            <p>{"429/Retry-After "}{weatherDiagnostics?.rateLimitedResponses ?? 0}
              {" · "}{lang === "ar" ? "باقي مهلة المزود" : "Provider cooldown"}{" "}
              {Math.ceil((weatherDiagnostics?.rateLimitRemainingMs ?? 0) / 1000)}{"s"}
            </p>
            <p>{"native errors "}{weatherDiagnostics?.performance.nativeFailures ?? 0}
              {" · canceled "}{weatherDiagnostics?.performance.nativeCancellations ?? 0}
              {" · tile errors "}{weatherDiagnostics?.performance.tileFailures.join("/") ?? "—"}
              {" · transfer MB "}{((weatherDiagnostics?.performance.nativeBytes ?? 0) / 1048576).toFixed(1)}
            </p>
            <p>{"SharedArrayBuffer: "}{weatherDiagnostics?.performance.runtime.crossOriginIsolated ? "available" : "unavailable"}
              {" · JS heap: "}{weatherDiagnostics?.performance.runtime.heapUsedMb == null
                ? "N/A" : `${weatherDiagnostics.performance.runtime.heapUsedMb} MB`}
            </p>
            <p className="text-white/60">{lang === "ar"
                ? "زمن البلاطة يشمل فك البيانات ورسمها ونقلها؛ لا يمكن فصلهما دون أدوات داخل عامل OM."
                : "Tile time includes decoding, rendering and delivery; worker-level breakdown is not exposed."}</p>
          </div>
          <p>{lang === "ar" ? "الإطارات الجاري تجهيزها" : "Decoding forecast frames"}: {weatherDiagnostics?.loadingFrames.join(", ") || "—"}</p>
          {(["cloud", "rain", "snow"] as const).map((name, index) => (
            <p key={name}>
              {name}: {weatherDiagnostics?.loaded[index] ? "loaded" : "pending"}
              {" · "}tiles {weatherDiagnostics?.tileCounts[index] ?? 0}
              {" · "}errors {weatherDiagnostics?.errors[index] ?? 0}
              {" · "}{lang === "ar" ? "المدة" : "elapsed"} {Math.round((weatherDiagnostics?.layerTimings[index]?.elapsedMs ?? 0) / 1000)}s
              {" · "}{lang === "ar" ? "أول بلاطة" : "first tile"} {weatherDiagnostics?.layerTimings[index]?.firstTileMs == null
                ? "—" : `${(weatherDiagnostics.layerTimings[index]!.firstTileMs! / 1000).toFixed(1)}s`}
              {weatherDiagnostics?.layerTimings[index]?.idleMs != null
                ? ` · idle ${Math.round(weatherDiagnostics.layerTimings[index]!.idleMs! / 1000)}s` : ""}
            </p>
          ))}
          <div className="mt-2 rounded-md border border-white/15 p-2 text-[0.66rem]">
            <p className="font-semibold">{lang === "ar" ? "MapTiler Weather — فحص تجريبي للبيانات الوصفية فقط" : "MapTiler Weather — catalog-only experimental probe"}</p>
            <p className="text-white/65">{lang === "ar"
              ? "لا يغير الطبقات أو محرك ECMWF. أدخل مفتاحًا عامًا مقيدًا للاختبار؛ لا يُحفظ."
              : "Does not change ECMWF or imagery. Enter a restricted public test key; it is not saved."}</p>
            <div className="mt-1 flex gap-1">
              <input type="password" autoComplete="off" value={pilotKey}
                onChange={(e) => setPilotKey(e.target.value)}
                placeholder={lang === "ar" ? "مفتاح MapTiler التجريبي" : "MapTiler test key"}
                aria-label={lang === "ar" ? "مفتاح MapTiler التجريبي" : "MapTiler test key"}
                className="min-w-0 flex-1 rounded border border-white/25 bg-transparent px-2 py-1 text-white"
              />
              <button type="button" className="rounded border border-white/35 px-2 py-1"
                disabled={pilotStatus === "loading" || !pilotKey.trim()}
                onClick={checkPilot}>
                {lang === "ar" ? "فحص" : "Check"}
              </button>
            </div>
            <p role="status">{pilotStatus === "ok"
              ? (lang === "ar" ? "تم التحقق من الفهرس" : "Catalog verified")
              : pilotStatus === "loading" ? (lang === "ar" ? "فحص المصدر..." : "Checking...")
              : pilotStatus === "not-run" ? (lang === "ar" ? "غير مفعل" : "Not enabled")
              : pilotStatus}</p>
            {pilotResult ? (
              <div>
                <p>{lang === "ar" ? "المتغيرات المتاحة" : "Catalog variables"}: {pilotResult.variables.length}</p>
                {pilotResult.variables.filter((v) => /cloud|precip|rain|snow/i.test(v.id)).slice(0, 8).map((v) => (
                  <p key={v.id}>{v.id}: {v.keyframeCount} frames · {v.firstTime ?? "—"} → {v.lastTime ?? "—"}</p>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-1 text-white/65">{lang === "ar" ? "للمقارنة فقط؛ لا يغير البيانات أو إعدادات الطبقات." : "Comparison only; does not alter forecast values."}</p>
        </div>
      ) : null}
      <div className="map-sheet pointer-events-none absolute inset-0 flex flex-col">
        {progress < 1 ? (
          <div className="mx-3 mt-1 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
        <div className="map-dock pointer-events-none mt-auto flex flex-col gap-2 px-3 pt-2">
          {system ? (
            <div className="wx-card pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-fg">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{system.name}</p>
                <p className="mt-1 text-[0.75rem] leading-snug text-muted">
                  {t(lang, "rainAmount")} · {formatNumber(system.rainMm, lang, 1)} {lang === "ar" ? "مم" : "mm"}
                </p>
                <p className="text-[0.75rem] leading-snug text-muted">
                  {t(lang, "moveSpeed")} · {compassFrom(system.moveDir, lang)} {formatWind(system.moveKmh, prefs.wind, lang)}
                </p>
                <p className="text-[0.75rem] leading-snug text-muted">
                  {t(lang, "stormGrade")} · {t(lang, stormGradeKey(system.windKmh))}
                </p>
              </div>
              <button type="button" className="flex size-7 shrink-0 items-center justify-center" onClick={() => setSystem(null)} aria-label={t(lang, "close")}>
                <X className="size-3.5" />
              </button>
            </div>
          ) : popup ? (
            <div className="wx-card pointer-events-auto flex items-center gap-2 px-2.5 py-2 text-fg">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{popup.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  {popup.code != null ? <WeatherIcon code={popup.code} isDay={popup.isDay} className="size-6 shrink-0 text-accent" /> : null}
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="text-lg font-semibold leading-none">{popup.temp == null ? "—" : formatTemp(popup.temp, prefs.temp, lang)}</span>
                    <span className="text-[0.65rem] leading-tight text-muted">
                      {popup.code != null ? t(lang, weatherKey(popup.code)) : sampleText(popup.sample, kind, prefs, lang)}
                      {popup.wind != null ? ` · ${formatWind(popup.wind, prefs.wind, lang)}` : ""}
                    </span>
                  </p>
                </div>
                {popup.loading ? (
                  <p className="mt-1 text-[0.65rem] text-muted">{t(lang, "updating")}</p>
                ) : (
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.65rem] leading-tight text-muted">
                    <span>{popup.timeZone ? formatClock(Date.now(), popup.timeZone, lang) : "—"}</span>
                    <span className="inline-flex items-center gap-1">
                      <Sunrise className="size-3.5 shrink-0" />
                      {popup.sunrise && popup.timeZone ? formatHour24(popup.sunrise, popup.timeZone) : "—"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Sunset className="size-3.5 shrink-0" />
                      {popup.sunset && popup.timeZone ? formatHour24(popup.sunset, popup.timeZone) : "—"}
                    </span>
                  </p>
                )}
              </div>
              <button type="button" className="flex size-7 shrink-0 items-center justify-center self-start" onClick={() => setPopup(null)} aria-label={t(lang, "close")}>
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          <div className="wx-card map-bar pointer-events-auto px-2 py-1.5">
            <div className="flex items-center gap-2" dir="ltr">
              <button
                type="button"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
                onClick={() => {
                  const next = !playing;
                  setPlaying(next);
                  engineRef.current?.setPlaying(next);
                }}
                aria-label={playing ? t(lang, "pause") : t(lang, "play")}
              >
                {playing ? (
                  <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                    <rect x="3.1" y="2.2" width="3.2" height="11.6" rx="0.8" fill="currentColor" />
                    <rect x="9.7" y="2.2" width="3.2" height="11.6" rx="0.8" fill="currentColor" />
                  </svg>
                ) : (
                  <Play className="size-3.5" />
                )}
              </button>
              <input
                ref={sliderRef}
                className="wx-range"
                type="range"
                min={0}
                max={Math.max(1, prefs.mapHours - 1)}
                step={0.01}
                defaultValue={0}
                aria-label={t(lang, "hourly")}
                onPointerDown={() => {
                  dragRef.current = true;
                  setPlaying(false);
                  engineRef.current?.setPlaying(false);
                }}
                onPointerUp={() => {
                  dragRef.current = false;
                }}
                onInput={(e) => engineRef.current?.setHour(Number(e.currentTarget.value))}
              />
            </div>
            {kind === 2 && playing && weatherLoadPhase > 0 ? (
              <div
                className="mt-1 flex items-center gap-1.5 rounded-md bg-accent/10 px-2 py-1 text-[0.67rem] leading-tight text-fg"
                dir={lang === "ar" ? "rtl" : "ltr"}
                role="status"
                aria-live="polite"
              >
                <svg className="size-3 shrink-0 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3a9 9 0 1 1-9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <span>{weatherLoadPhase === 2
                  ? (lang === "ar" ? "تحميل التوقعات أبطأ من المعتاد — يمكنك اختيار ساعة أخرى" : "Forecast loading is slow — you can select another hour")
                  : (lang === "ar" ? "جاري تجهيز التوقع التالي…" : "Preparing next forecast…")}</span>
              </div>
            ) : null}
            <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-fg">{t(lang, kind === 0 ? "windLayer" : kind === 2 ? "rainLayer" : "tempLayer")}</span>
              <span ref={valueRef} className="font-semibold text-accent">—</span>
            </div>
            <span ref={timeRef} className="block text-[0.65rem] leading-tight text-muted">{t(lang, "today")}</span>
            <div className="mt-1 h-1 rounded-full" style={{ background: gradient }} />
            <div className="mt-0.5 flex justify-between text-[0.65rem] leading-none text-muted" dir="ltr">
              {ticks.map((tick) => <span key={tick}>{tickText(tick, kind, prefs, lang)}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CycloneGlyph() {
  return (
    <svg className="cyclone-glyph" viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="#d92b1c"
        d="M12.9 51.4L15.1 52.1L17.3 52.6L19.5 52.9L21.6 52.9L23.6 52.7L25.5 52.4L27.3 52L29 51.5L30.6 51L32.1 50.4L33.6 49.8L34.9 49.2L36.2 48.4L37.4 47.6L38.5 46.7L39.5 45.8L40.3 44.8L41.1 43.8L41.8 42.7L42.4 41.6L42.8 40.5L43.2 39.4L43.4 38.3L43.6 37.2L43.6 36.2L43.5 35.1L43.3 34.1L43 33.2L42.6 32.4L42.2 31.6L41.6 30.9L41.1 30.3L40.5 29.7L39.9 29.3L39.3 28.9L38.7 28.6L38.1 28.4L37.5 28.2L37 28L36.5 27.9L36 27.8L35.5 27.8L35.1 27.7L34.7 27.7L34.3 27.7L33.9 27.7L33.5 27.7L33.1 27.7L32.8 27.8L32.5 27.9L32.2 28L31.9 28.1L31.6 28.3L31.4 28.5L31.3 28.7L31.1 28.9L31.1 29.1L31 29.4L31.1 29.6L31.1 29.8L31.2 29.9L31.3 30.1L31.4 30.2L31.6 30.2L31.7 30.3L31.8 30.3L31.7 30.3L31.1 30.6L30 31.2L28.6 32.3L27 33.9L25.7 35.8L24.8 36.6L24.4 36L23.5 35.7L22.5 35.3L21.7 34.7L21.1 34L20.8 33.1L20.6 32.1L20.5 31.1L20.5 30.1L20.6 29.2L20.7 28.2L21 27.2L21.3 26.2L21.7 25.2L22.2 24.3L22.8 23.4L23.4 22.5L24.2 21.7L25 20.9L25.9 20.2L26.8 19.6L27.8 19L28.9 18.5L30 18.1L31.2 17.8L32.4 17.6L33.7 17.5L34.9 17.5L36.2 17.6L37.5 17.8L38.7 18.2L40 18.6L41.2 19.1L42.4 19.8L43.5 20.6L44.6 21.4L45.7 22.4L46.7 23.5L47.5 24.6L48.3 25.9L49 27.2L49.6 28.6L50.1 30.1L50.5 31.6L50.7 33.2L50.8 34.8L50.8 36.5L50.6 38.1L50.3 39.8L49.9 41.4L49.3 43.1L48.5 44.7L47.6 46.2L46.6 47.7L45.4 49.2L44.1 50.5L42.7 51.8L41.1 52.9L39.4 54L37.6 54.9L35.7 55.6L33.8 56.2L31.7 56.6L29.6 56.8L27.4 56.9L25.3 56.6L23.1 56.2L20.9 55.6L18.8 54.8L16.8 53.8L14.8 52.7L12.9 51.4Z"
      />
      <path
        fill="#ffe3d2"
        d="M20.8 49.2L21.8 49.3L22.9 49.4L23.9 49.4L24.9 49.4L25.9 49.3L26.8 49.2L27.7 49.1L28.6 49L29.5 48.8L30.4 48.7L31.2 48.5L32 48.3L32.8 48.1L33.6 47.8L34.3 47.5L35.1 47.2L35.8 46.8L36.4 46.4L37.1 46L37.7 45.5L38.3 45.1L38.8 44.6L39.4 44.1L39.8 43.5L40.3 43L40.7 42.4L41.1 41.8L41.4 41.2L41.7 40.6L42 40L42.2 39.4L42.4 38.8L42.5 38.2L42.7 37.6L42.7 37L42.8 36.4L42.8 35.8L42.8 35.2L42.8 34.6L42.8 34L42.7 33.5L42.6 32.9L42.5 32.4L42.4 31.9L42.2 31.4L42 30.9L41.8 30.4L41.6 30L41.4 29.5L41.1 29.1L40.9 28.7L40.6 28.3L40.3 27.9L39.9 27.6L39.6 27.3L39.2 27L38.9 26.7L38.5 26.5L38.1 26.3L37.8 26.1L37.4 25.9L37 25.7L36.6 25.6L36.2 25.5L35.8 25.4L35.4 25.3L35.1 25.3L34.7 25L34.4 24.6L34 24.1L33.5 23.5L33 22.9L32.9 22.5L33.4 22.4L33.9 22.2L34.5 22L35 21.8L35.6 21.8L36.1 21.9L36.7 22L37.2 22.2L37.8 22.4L38.3 22.6L38.8 22.8L39.4 23.1L39.9 23.4L40.4 23.7L40.9 24.1L41.3 24.5L41.8 24.9L42.2 25.3L42.7 25.8L43.1 26.3L43.5 26.8L43.8 27.3L44.2 27.9L44.5 28.5L44.8 29.1L45 29.7L45.2 30.4L45.4 31L45.6 31.7L45.7 32.4L45.8 33.1L45.9 33.8L45.9 34.5L45.9 35.3L45.9 36L45.8 36.7L45.7 37.5L45.5 38.2L45.3 39L45.1 39.7L44.8 40.4L44.5 41.2L44.1 41.9L43.7 42.6L43.3 43.3L42.8 43.9L42.3 44.6L41.7 45.2L41.2 45.8L40.5 46.4L39.9 47L39.2 47.5L38.5 48L37.7 48.5L36.9 48.9L36.1 49.3L35.2 49.7L34.4 50L33.5 50.3L32.6 50.5L31.6 50.7L30.7 50.9L29.7 51L28.7 51L27.7 51L26.7 50.9L25.7 50.7L24.7 50.5L23.7 50.3L22.7 49.9L21.7 49.6L20.8 49.2Z"
      />
      <circle cx="32" cy="32" r="2.55" fill="#fffaf6" />
      <circle cx="32" cy="32" r="1.15" fill="#1a100e" />
    </svg>
  );
}

function nearbyRain(
  place: Place,
  bundle: WeatherBundle | null,
  lat: number,
  lon: number,
  timeMs: number,
): number | null {
  if (!bundle || bundle.placeId !== place.id || !bundle.hourly.length) return null;
  const cos = Math.cos((place.lat * Math.PI) / 180);
  if (Math.hypot(lat - place.lat, (lon - place.lon) * cos) > 2.2) return null;
  let best = bundle.hourly[0]!;
  let dist = Number.POSITIVE_INFINITY;
  for (const hour of bundle.hourly) {
    const gap = Math.abs(hour.t - timeMs);
    if (gap < dist) {
      dist = gap;
      best = hour;
    }
  }
  if (dist > 3 * 3_600_000) return null;
  return best.precip;
}

function sampleText(
  sample: FieldSample | null,
  kind: ShadeKind,
  prefs: { temp: "c" | "f"; wind: "kmh" | "ms" | "mph" | "kn" },
  lang: Lang,
): string {
  if (!sample) return "—";
  if (kind === 0) return formatWind(sample.spd, prefs.wind, lang);
  if (kind === 1) return formatTemp(sample.temp, prefs.temp, lang);
  const mm = formatNumber(sample.rain, lang, 1);
  const snow = sample.snow ?? 0;
  if (snow >= 0.08) {
    const cm = formatNumber(snow, lang, 1);
    return lang === "ar" ? `ثلج ${cm} سم` : `snow ${cm} cm`;
  }
  return `${mm} mm`;
}

function tickText(value: number, kind: ShadeKind, prefs: { temp: "c" | "f"; wind: "kmh" | "ms" | "mph" | "kn" }, lang: Lang): string {
  if (kind === 1) return formatTemp(value, prefs.temp, lang);
  if (kind === 0) return formatNumber(convertWind(value, prefs.wind), lang, 0);
  return formatNumber(value, lang, 0);
}

function Mark({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function WindMark() {
  return (
    <Mark>
      <path d="M4 8.2c2.2-1.5 3.4-1.5 5.2 0s3 1.5 5.2 0 3-1.5 5.2 0" />
      <path d="M3.5 12c2.4-1.6 3.6-1.6 5.6 0s3.2 1.6 5.6 0 3.2-1.6 5.8 0" />
      <path d="M4 15.8c2.2-1.5 3.4-1.5 5.2 0s3 1.5 5.2 0 2.6-1.3 4.6 0" />
    </Mark>
  );
}

function ThermoMark() {
  return (
    <Mark>
      <path d="M10 14.2V5.5a2 2 0 1 1 4 0v8.7a3.2 3.2 0 1 1-4 0Z" />
      <path d="M12 14.5v-5" />
    </Mark>
  );
}

function RainMark() {
  return (
    <Mark>
      <path d="M7.2 15.2a3.6 3.6 0 0 1-.4-7 4.6 4.6 0 0 1 8.8-1.2 3.2 3.2 0 0 1 .6 6.3" />
      <path d="M9 17.2v2.2M12 17.6v2.4M15 17.2v2.2" />
    </Mark>
  );
}

function PlusMark() {
  return (
    <Mark>
      <path d="M12 6.5v11M6.5 12h11" />
    </Mark>
  );
}

function MinusMark() {
  return (
    <Mark>
      <path d="M6.5 12h11" />
    </Mark>
  );
}

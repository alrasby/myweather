import { Play, Sunrise, Sunset, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { loadWeather, placeFromCoords } from "@/weather/api";
import { FieldEngine, type FrameInfo } from "@/weather/glField";
import { covers, gridFailureReason, fetchGrid } from "@/weather/grid";
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
import type { FieldSample, GridField, Lang, Place, ShadeKind } from "@/weather/types";
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
  const z = Math.ceil(Math.log2(Math.max(el.clientWidth || 360, el.clientHeight || 640) / 256));
  return Math.min(5, Math.max(2, z));
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
  const engineRef = useRef<FieldEngine | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<LeafletNs | null>(null);
  const placeRef = useRef(place);
  const prefsRef = useRef(prefs);
  const langRef = useRef(lang);
  const tzRef = useRef(bundle?.timezone ?? "UTC");
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
  const [kind, setKind] = useState<ShadeKind>(prefs.mapLayer);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [gridFailed, setGridFailed] = useState(false);
  const [gridErrorKind, setGridErrorKind] = useState("unknown");
  const [gridRetry, setGridRetry] = useState(0);
  const [pins, setPins] = useState<Array<LiveCyclone & { x: number; y: number }>>([]);
  const [cycloneMsg, setCycloneMsg] = useState<string | null>(null);
  const cycloneDismissed = useRef(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [system, setSystem] = useState<SystemCard | null>(null);
  placeRef.current = place;
  prefsRef.current = prefs;
  langRef.current = lang;
  tzRef.current = bundle?.timezone ?? tzRef.current;
  kindRef.current = kind;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false;
    let map: LeafletMap | null = null;
    const engine = new FieldEngine(el);
    engineRef.current = engine;
    const paint = (info: FrameInfo) => {
      const current = prefsRef.current;
      const language = langRef.current;
      if (timeRef.current) {
        timeRef.current.textContent = formatClock(info.timeMs, tzRef.current, language);
      }
      if (valueRef.current) {
        valueRef.current.textContent = info.sample
          ? sampleText(info.sample, kindRef.current, current, language)
          : "—";
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
          zoomAnimation: false,
          fadeAnimation: false,
          worldCopyJump: true,
          inertia: true,
          doubleClickZoom: false,
        });
        const here = placeRef.current;
        map.setView([here.lat, here.lon], 5);
        const pole = 85.0511287798;
        let locking = false;
        const lockPoles = () => {
          if (locking) return;
          const size = map!.getSize();
          if (size.y < 8) return;
          const midX = size.x / 2;
          const top = map!.containerPointToLatLng([midX, 0]);
          const bot = map!.containerPointToLatLng([midX, size.y]);
          const overNorth = top.lat > pole;
          const overSouth = bot.lat < -pole;
          let dy = 0;
          if (overNorth) dy += map!.latLngToContainerPoint([pole, top.lng]).y;
          if (!overNorth && overSouth) dy += map!.latLngToContainerPoint([-pole, bot.lng]).y - size.y;
          if (Math.abs(dy) > 0.5) {
            locking = true;
            map!.panBy([0, dy], { animate: false });
            locking = false;
          }
        };
        map.on("move zoom", lockPoles);
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 16,
        }).addTo(map);
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 16, opacity: 0.92 },
        ).addTo(map);
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
    map.invalidateSize();
    engine.resize();
  }, [active, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.flyTo([place.lat, place.lon], Math.max(map.getZoom(), 6), { duration: 0.7 });
  }, [place.id, ready]);

  useEffect(() => {
    engineRef.current?.setKind(kind);
  }, [kind]);

  useEffect(() => {
    setKind(prefs.mapLayer);
  }, [prefs.mapLayer]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    const n = prefs.dataSaver ? 0 : prefs.particles === "high" ? 650 : 420;
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
    let worldStarted = false;
    const worldAc = new AbortController();
    let detailAc: AbortController | null = null;
    detailRef.current = null;
    engine.setDetail(null);
    engine.setRainView(null);
    engine.setRainWorld(null);
    engine.setGlobal(null);
    const hours = prefs.mapHours;
    let worldFinished = false;
    let worldSucceeded = false;
    const saver = prefs.dataSaver;
    setProgress(0.08);
    setGridFailed(false);
    const world = { south: -85.0511, north: 85.0511, west: -180, lonSpan: 360, hours, full: true as const };

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
      if (dead) return;
      // Viewport data is the primary source; never gate it behind a global fetch.
      const view = viewSpan();
      if (view.span > 120 || view.span < 0.05) {
        startWorld();
        detailGen += 1;
        detailAc?.abort();
        detailAc = null;
        detailRef.current = null;
        engine.setDetail(null);
        engine.setRainView(null);
        return;
      }
      const span = view.span;
      const padLon = Math.max(0.08, span * 0.2);
      const padLat = Math.max(0.08, (view.north - view.south) * 0.2);
      const south = Math.max(-85, view.south - padLat);
      const north = Math.min(85, view.north + padLat);
      const west = view.west - padLon;
      const lonSpan = Math.max(0.2, view.east + padLon - west);
      const loaded = detailRef.current;
      if (loaded && covers(loaded, view) && span > loaded.lonSpan * 0.4) return;
      const mine = ++detailGen;
      detailAc?.abort();
      detailAc = new AbortController();
      const cell = Math.max(0.025, span / 16);
      const cols = Math.max(6, Math.min(saver ? 6 : 8, Math.round(lonSpan / cell)));
      const rows = Math.max(6, Math.min(saver ? 6 : 8, Math.round(cols * map.getSize().y / Math.max(1, map.getSize().x))));
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
          if (now.span > 120 || !covers(grid, now)) return;
          detailRef.current = grid;
          engine.setDetail(grid);
          engine.setRainView(grid);
          setGridFailed(false);
          setGridErrorKind("unknown");
          setProgress(1);
        })
        .catch(() => {
          if (!dead && mine === detailGen) {
            // A failed local request must not trigger a second global request storm.
            if (!worldStarted && viewSpan().span > 120) startWorld();
            if (!worldSucceeded && !detailRef.current) {
              setGridErrorKind(gridFailureReason());
              setGridFailed(true);
              setProgress(1);
            }
          }
        });
    };
    const consider = () => {
      window.clearTimeout(timer);
      if (viewSpan().span > 120 && !worldStarted) startWorld();
      timer = window.setTimeout(pullDetail, 320);
    };
    map.on("moveend", consider);
    map.on("zoomend", consider);
    const startWorld = () => {
      if (worldStarted || dead) return;
      worldStarted = true;
      void (async () => {
      try {
        // A shared global field complements independently fetched viewport detail.
        const globalGrid = await loadWorld(saver ? 6 : 8, saver ? 4 : 5, 0.05, 0.98);
        if (dead) return;
        engine.setGlobal(globalGrid);
        engine.setRainWorld(globalGrid);
        worldSucceeded = true;
        setGridFailed(false);
        setGridErrorKind("unknown");
        worldFinished = true;
        setProgress(1);
        consider();
      } catch {
        if (!dead && !worldAc.signal.aborted) {
          worldFinished = true;
          consider();
          // Wait for viewport fallback before declaring all weather layers unavailable.
          setProgress(0.9);
        }
      }
    })();
    };
    // Only fetch the costly global field for a genuinely global viewport.
    // Local navigation must not spend the quota on an unseen world grid.
    if (viewSpan().span > 120) startWorld();
    consider();
    return () => {
      dead = true;
      worldAc.abort();
      detailAc?.abort();
      window.clearTimeout(timer);
      map.off("moveend", consider);
      map.off("zoomend", consider);
    };
  }, [ready, prefs.mapHours, prefs.dataSaver, gridRetry]);

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
      <div ref={hostRef} dir="ltr" className="map-host absolute inset-0" />
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
        <button type="button" className="map-tool map-tool-gap" onClick={() => mapRef.current?.zoomIn()} aria-label="+">
          <PlusMark />
        </button>
        <button type="button" className="map-tool" onClick={() => mapRef.current?.zoomOut()} aria-label="-">
          <MinusMark />
        </button>
      </div>
      <div className="map-sheet pointer-events-none absolute inset-0 flex flex-col">
        {gridFailed ? (
          <div role="status" className="wx-card pointer-events-auto mx-3 px-3 py-2 text-sm text-fg"
            style={{ marginTop: "calc(env(safe-area-inset-top, 0px) + 32px)" }}>
            {lang === "ar" ? (gridErrorKind === "quota" ? "خدمة بيانات الطقس مقيّدة مؤقتًا. حاول لاحقًا." : gridErrorKind === "incomplete" ? "لم تُرجع خدمة الطقس بيانات كافية للخريطة." : gridErrorKind === "provider" ? "رفضت خدمة الطقس بعض الطلبات." : "تعذّر الاتصال بخدمة بيانات الطقس.") : (gridErrorKind === "quota" ? "Weather provider rate limit. Try later." : gridErrorKind === "incomplete" ? "Weather provider returned insufficient map data." : gridErrorKind === "provider" ? "Weather provider rejected requests." : "Could not reach weather data service.")}
            <button type="button" className="mx-2 underline" onClick={() => setGridRetry(n => n + 1)}>
              {lang === "ar" ? "إعادة المحاولة" : "Retry"}
            </button>
          </div>
        ) : null}
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
            <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-fg">{t(lang, kind === 0 ? "windLayer" : kind === 2 ? "rainLayer" : "tempLayer")}</span>
              <span ref={valueRef} className="font-semibold text-accent">—</span>
            </div>
            <span ref={timeRef} className="block text-[0.65rem] leading-tight text-muted">{t(lang, "today")}</span>
            <div className="mt-1 h-1 rounded-full" style={{ background: gradient }} />
            <div className="mt-0.5 flex justify-between text-[0.65rem] leading-none text-muted" dir="ltr">
              {ticks.map((tick) => (
                <span key={tick}>{tickText(tick, kind, prefs, lang)}</span>
              ))}
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
    return lang === "ar" ? `ثلج ${cm} سم/س` : `snow ${cm} cm/h`;
  }
  return lang === "ar" ? `${mm} مم/س` : `${mm} mm/h`;
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

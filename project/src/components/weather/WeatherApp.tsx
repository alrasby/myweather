import { celestialMotion } from "@/weather/celestialMotion";
import { House, Map as MapIcon, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CitiesScreen } from "@/components/weather/CitiesScreen";
import { HomeScreen } from "@/components/weather/HomeScreen";
import { SettingsScreen } from "@/components/weather/SettingsScreen";
import { SkyBackdrop } from "@/components/weather/SkyBackdrop";
import { daylightNow } from "@/weather/astro";
import { placeTitle } from "@/weather/format";
import { hasWorldPack } from "@/weather/i18n-world";
import { t } from "@/weather/i18n";
import { applyUi, deviceUi, resolveUi, type Ui } from "@/weather/locale";
import { activePlace, useWeather } from "@/weather/store";
import { widgetPayload } from "@/weather/widget";
import type { TabId, WeatherBundle } from "@/weather/types";
import { loadWeather } from "@/weather/api";
import { warmSpatialMetadata } from "@/weather/spatialMetadataWarmup";

const loadMapScreen = () => import("@/components/weather/MapScreen");
const MapScreen = lazy(() => loadMapScreen().then((m) => ({ default: m.MapScreen })));

export function WeatherApp() {
  const hydrate = useWeather((s) => s.hydrate);
  const hydrated = useWeather((s) => s.hydrated);
  const activeId = useWeather((s) => s.activeId);
  const places = useWeather((s) => s.places);
  const peek = useWeather((s) => s.peek);
  const revision = useWeather((s) => s.revision);
  const loadActive = useWeather((s) => s.loadActive);
  const prefs = useWeather((s) => s.prefs);
  const bundle = useWeather((s) => s.bundle);
  const estimated = useWeather((s) => s.estimated);
  const here = useWeather((s) => s.here);
  const [herePack, setHerePack] = useState<{ place: NonNullable<typeof here>; bundle: WeatherBundle } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current, navigation = navigationRef.current;
    if (!shell || !navigation) return;
    // Measure the whole occupied dock: actual bar height, margin and device inset.
    // Observing the dock also handles font scaling and gesture/three-button insets.
    const measure = () => shell.style.setProperty("--wx-nav-occupied", `${Math.ceil(navigation.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(navigation);
    return () => observer.disconnect();
  }, []);
  const [tab, setTab] = useState<TabId>("home");
  const [placesOpen, setPlacesOpen] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [device, setDevice] = useState<Ui | null>(null);
  const ui = resolveUi(prefs.lang, device);
  applyUi(ui);
  const lang = ui.copy;
  const place = activePlace({ places, activeId, peek });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (prefs.lang !== "system") {
      setDevice(null);
      return;
    }
    setDevice(deviceUi(hasWorldPack));
  }, [prefs.lang]);

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    void loadActive(false, ac.signal);
    return () => ac.abort();
  }, [hydrated, activeId, revision, loadActive]);

  useEffect(() => {
    if (!hydrated) return;
    const kick = () => {
      if (document.visibilityState === "hidden") return;
      const state = useWeather.getState();
      if (state.loading || (!state.estimated && !state.error)) return;
      void state.loadActive(true);
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!here) {
      setHerePack(null);
      return;
    }
    if (bundle?.placeId === here.id) {
      setHerePack({ place: here, bundle });
      return;
    }
    const ac = new AbortController();
    void loadWeather(here, { signal: ac.signal })
      .then((res) => setHerePack({ place: here, bundle: res.bundle }))
      .catch(() => undefined);
    return () => ac.abort();
  }, [here, bundle]);

  useEffect(() => {
    if (!bundle || bundle.placeId !== place.id) return;
    const bridge = (window as unknown as { AndroidWidget?: { push?: (json: string) => void } }).AndroidWidget;
    if (!bridge?.push) return;
    bridge.push(JSON.stringify(widgetPayload(bundle, place, places, lang, prefs.temp, ui.dir === "rtl", herePack)));
  }, [bundle, place, places, lang, prefs.temp, ui.dir, herePack]);

  useEffect(() => {
    if (!hydrated || !prefs.refreshMin) return;
    const id = window.setInterval(() => {
      void (async () => {
        if (prefs.wifiOnly && !(await onUnmetered())) return;
        void loadActive(true);
      })();
    }, prefs.refreshMin * 60_000);
    return () => window.clearInterval(id);
  }, [hydrated, prefs.refreshMin, prefs.wifiOnly, loadActive]);

  useEffect(() => {
    let timer = 0;
    const sync = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
      if (!document.hidden) {
        setClock(Date.now());
        timer = window.setInterval(() => setClock(Date.now()), 30_000);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // A scene is atomic: never borrow any field from another city, or animate
  // guessed weather while a real snapshot for the selected city is loading.
  const sky = !estimated && bundle?.placeId === place.id ? bundle : null;
  const daylight = daylightNow(clock, place.lat, place.lon, sky?.daily, sky?.hourly);
  const light =
    prefs.theme === "light" ||
    (prefs.theme === "system" && !systemDark) ||
    (prefs.theme === "sun" && daylight);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = ui.tag;
    root.dir = ui.dir;
    root.classList.toggle("light", light);
    const name = t(lang, "app");
    const where = placeTitle(place, lang);
    document.title = where ? `${name} — ${where}` : name;
  }, [ui.tag, ui.dir, lang, light, place]);

  useEffect(() => {
    const home = () => {
      setTab("home");
      setPlacesOpen(false);
      try {
        sessionStorage.removeItem("myweather-home");
      } catch {
        /* جلسة بلا تخزين */
      }
    };
    window.__wxHome = home;
    try {
      if (sessionStorage.getItem("myweather-home") === "1") home();
    } catch {
      /* جلسة بلا تخزين */
    }
    return () => {
      if (window.__wxHome === home) delete window.__wxHome;
    };
  }, []);

  useEffect(() => {
    if (tab !== "home") setPlacesOpen(false);
  }, [tab]);

  // Weather forecasts on Home retain first network priority. Only after a
  // genuine Home forecast is loaded, and only off data-saver, preload the
  // existing map JS chunk + one short-lived ECMWF metadata request.
  // No raster tiles or stale screenshots are prefetched or mislabelled.
  useEffect(() => {
    if (!hydrated || !bundle || bundle.placeId !== place.id || tab !== "home" || prefs.dataSaver || document.hidden ||
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const id = window.setTimeout(() => {
      if (document.hidden) return;
      void loadMapScreen().catch(() => undefined);
      warmSpatialMetadata();
    }, 700);
    return () => window.clearTimeout(id);
  }, [hydrated, bundle?.placeId, place.id, tab, prefs.dataSaver]);

  const showMap = tab === "map";
  const code = sky?.current.code ?? 0;
  const celestial = celestialMotion(place.lat, place.lon, clock, sky?.daily);

  return (
    <div ref={shellRef} className={`wx-app relative flex h-dvh flex-col overflow-hidden ${light ? "" : "is-night"}`}>
      <SkyBackdrop key={place.id} day={daylight} code={code} cover={sky?.current.cloud ?? 0}
        showClouds={sky !== null}
        wind={sky?.current.wind ?? 0} direction={sky?.current.dir ?? 0}
        heroWeather={tab === "home" && !placesOpen && sky !== null}
        animateClouds={tab === "home" && !placesOpen && sky !== null}
        celestial={celestial} />
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
        <section className={`under-status mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col ${tab === "map" ? "hidden" : ""}`}>
          <div className="min-h-0 flex-1">
            {placesOpen ? (
              <CitiesScreen lang={lang} onClose={() => setPlacesOpen(false)} />
            ) : tab === "settings" ? (
              <SettingsScreen lang={lang} />
            ) : (
              <HomeScreen lang={lang} onOpenPlaces={() => setPlacesOpen(true)} />
            )}
          </div>
        </section>
        <section className={`relative min-h-0 min-w-0 flex-1 ${tab === "map" ? "" : "hidden"}`}>
          {showMap ? (
            <Suspense fallback={<div className="h-full" />}>
              <MapScreen lang={lang} active={tab === "map"} />
            </Suspense>
          ) : null}
        </section>
      </div>
      <nav ref={navigationRef} aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"} className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center">
        <div className="glass-bar wx-bottom-nav pointer-events-auto mb-1.5 flex rounded-full">
          {(
            [
              ["home", House, "home"],
              ["map", MapIcon, "map"],
              ["settings", Settings, "settings"],
            ] as const
          ).map(([id, Icon, key]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "map") {
                  // Start the small metadata request before lazy React mount.
                  // Later attach joins the same request; no duplicate reads.
                  warmSpatialMetadata();
                  void loadMapScreen().catch(() => undefined);
                }
                setTab(id);
              }}
              aria-current={tab === id ? "page" : undefined}
              className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.71rem] leading-none ${tab === id ? "nav-on" : "text-on-sky/90"}`}
            >
              <Icon className="size-[1.12rem]" aria-hidden="true" />
              <span className="nav-label max-w-full px-1 text-center">{t(lang, key)}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

async function onUnmetered(): Promise<boolean> {
  const bridge = (window as unknown as { AndroidWidget?: { unmetered?: () => boolean } }).AndroidWidget;
  if (typeof bridge?.unmetered === "function") return !!bridge.unmetered();
  const nav = navigator as Navigator & { connection?: { type?: string } };
  const type = nav.connection?.type;
  if (!type) return true;
  return type === "wifi" || type === "ethernet" || type === "unknown";
}

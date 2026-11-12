import { House, Map as MapIcon, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { CitiesScreen } from "@/components/weather/CitiesScreen";
import { HomeScreen } from "@/components/weather/HomeScreen";
import { SettingsScreen } from "@/components/weather/SettingsScreen";
import { SkyBackdrop } from "@/components/weather/SkyBackdrop";
import { moonState, daylightNow } from "@/weather/astro";
import { placeTitle } from "@/weather/format";
import { hasWorldPack } from "@/weather/i18n-world";
import { t } from "@/weather/i18n";
import { applyUi, deviceUi, resolveUi, type Ui } from "@/weather/locale";
import { activePlace, useWeather } from "@/weather/store";
import { widgetPayload } from "@/weather/widget";
import type { TabId, WeatherBundle } from "@/weather/types";
import { loadWeather } from "@/weather/api";

const MapScreen = lazy(() => import("@/components/weather/MapScreen").then((m) => ({ default: m.MapScreen })));

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
  const here = useWeather((s) => s.here);
  const [herePack, setHerePack] = useState<{ place: NonNullable<typeof here>; bundle: WeatherBundle } | null>(null);
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
    if (!bundle) return;
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
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setSystemDark(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const daylight = daylightNow(clock, place.lat, place.lon, bundle?.daily, bundle?.hourly);
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

  const showMap = tab === "map";
  const code = bundle?.current.code ?? 1;

  return (
    <div className={`relative flex h-dvh flex-col overflow-hidden ${light ? "" : "is-night"}`}>
      <SkyBackdrop day={daylight} code={code} cover={bundle?.current.cloud ?? 50} phase={moonState(clock).frac} showClouds={false} />
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
      <nav className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center">
        <div className="glass-bar pointer-events-auto mb-1.5 flex w-[min(76%,19.5rem)] rounded-full px-0.5 py-0.5">
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
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`flex min-h-10 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[0.62rem] leading-none ${tab === id ? "nav-on" : "text-on-sky/90"}`}
            >
              <Icon className="size-4" />
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

import { create } from "zustand";
import { clearBundles, loadWeather, readCacheFile, writeCacheFile } from "@/weather/api";
import { estimateBundle } from "@/weather/estimate";
import { INITIAL_CITIES, upgradeInitialCities } from "@/weather/defaultCities";
import { readLastViewed, restoreViewedPlace, saveLastViewed } from "@/weather/lastViewedPlace";
import {
  CACHE_TTL_MS,
  MUSCAT,
  DEFAULT_PREFS,
  MAX_CACHED_PLACES,
  PREFS_KEY,
  CACHE_KEY,
  type Place,
  type Prefs,
  type WeatherBundle,
} from "@/weather/types";

type CacheEntry = { at: number; bundle: WeatherBundle };

type WeatherState = {
  hydrated: boolean;
  places: Place[];
  activeId: string;
  prefs: Prefs;
  bundle: WeatherBundle | null;
  stale: boolean;
  estimated: boolean;
  loading: boolean;
  error: boolean;
  notice: string | null;
  revision: number;
  peek: Place | null;
  here: Place | null;
  hydrate: () => void;
  loadActive: (force?: boolean, signal?: AbortSignal) => Promise<void>;
  setActive: (id: string) => void;
  addPlace: (place: Place, replaceId?: string | null, opts?: { activate?: boolean }) => void;
  viewPlace: (place: Place) => void;
  locatePlace: (place: Place) => void;
  setHere: (place: Place | null) => void;
  removePlace: (id: string) => void;
  movePlace: (id: string, dir: -1 | 1) => void;
  makePrimary: (id: string) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  clearCache: () => void;
  setNotice: (notice: string | null) => void;
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readPrefs(): Prefs {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "null") as Partial<Prefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
    const mapHours = raw.mapHours === 24 || raw.mapHours === 48 || raw.mapHours === 72 ? raw.mapHours : DEFAULT_PREFS.mapHours;
    const stormsSet = raw.stormsSet === true;
    return {
      ...DEFAULT_PREFS,
      ...raw,
      storms: stormsSet ? raw.storms !== false : true,
      stormsSet,
      mapHours,
      lang: oneOf(raw.lang, ["system", "ar", "en"] as const, DEFAULT_PREFS.lang),
      theme: oneOf(raw.theme, ["sun", "system", "light", "dark"] as const, DEFAULT_PREFS.theme),
      mapLayer: raw.mapLayer === 0 || raw.mapLayer === 1 || raw.mapLayer === 2 ? raw.mapLayer : DEFAULT_PREFS.mapLayer,
      refreshMin: oneOf(String(raw.refreshMin), ["0", "15", "30", "60", "180", "360"] as const, String(DEFAULT_PREFS.refreshMin)) === String(raw.refreshMin)
        ? (raw.refreshMin as Prefs["refreshMin"])
        : DEFAULT_PREFS.refreshMin,
      particles: oneOf(raw.particles, ["low", "med", "high"] as const, DEFAULT_PREFS.particles),
      morning: oneOf(raw.morning, ["5:30", "6:00", "6:30", "7:30"] as const, DEFAULT_PREFS.morning),
      quiet: oneOf(raw.quiet, ["off", "22-6", "23-7"] as const, DEFAULT_PREFS.quiet),
      rainAlert: raw.rainAlert === 0.2 || raw.rainAlert === 1 || raw.rainAlert === 2 ? raw.rainAlert : DEFAULT_PREFS.rainAlert,
      windAlert: raw.windAlert === 30 || raw.windAlert === 45 || raw.windAlert === 60 ? raw.windAlert : DEFAULT_PREFS.windAlert,
      dustAlert: raw.dustAlert === 80 || raw.dustAlert === 150 || raw.dustAlert === 250 ? raw.dustAlert : DEFAULT_PREFS.dustAlert,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    const nav = typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
    const boot = prefs.lang === "en" || (prefs.lang === "system" && !nav.startsWith("ar")) ? "en" : "ar";
    localStorage.setItem("myweather-boot", boot);
  } catch {
    /* تجاهل امتلاء التخزين */
  }
}

const HERE_KEY = "myweather-here";

function readHere(): Place | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(HERE_KEY) || "null") as Place | null;
    if (!raw || typeof raw.lat !== "number" || typeof raw.lon !== "number" || !raw.id) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveHere(place: Place | null) {
  try {
    if (!place) localStorage.removeItem(HERE_KEY);
    else localStorage.setItem(HERE_KEY, JSON.stringify(place));
  } catch {
    /* تجاهل امتلاء التخزين */
  }
}

function persistPlaces(places: Place[], activeId: string) {
  const file = readCacheFile();
  const entries: Record<string, CacheEntry> = {};
  for (const place of places) {
    const entry = file.entries[place.id];
    if (entry) entries[place.id] = entry;
  }
  writeCacheFile({ places, activeId, entries });
}

function sameSpot(a: Place, b: Place): boolean {
  return a.id === b.id || kmBetween(a.lat, a.lon, b.lat, b.lon) < 0.35;
}

function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const x = (aLat - bLat) * 110.574;
  const y = (aLon - bLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(x, y);
}

let activeLoadGeneration = 0;

export const useWeather = create<WeatherState>((set, get) => ({
  hydrated: false,
  places: INITIAL_CITIES.map((p) => ({ ...p })),
  activeId: MUSCAT.id,
  prefs: DEFAULT_PREFS,
  bundle: null,
  stale: false,
  estimated: false,
  loading: false,
  error: false,
  notice: null,
  revision: 0,
  peek: null,
  here: null,
  hydrate: () => {
    const prefs = readPrefs();
    const file = readCacheFile();
    const here = readHere();
    // Starter cities are deterministic, independent of an unapproved GPS fix.
    // Existing user cities stay intact except for the requested legacy swap.
    const upgrade = upgradeInitialCities(file.places.slice(0, MAX_CACHED_PLACES), file.activeId);
    const places = upgrade.places;
    const fallbackId = upgrade.changed ? upgrade.activeId :
      places.some((p) => p.id === file.activeId) ? file.activeId :
      (places.find((p) => p.primary)?.id ?? MUSCAT.id);
    const viewed = restoreViewedPlace(readLastViewed(), places, fallbackId);
    // A manually viewed but unsaved location remains active after restart;
    // it does NOT silently join the user's saved-city list.
    if (upgrade.changed) persistPlaces(places, fallbackId);
    savePrefs(prefs);
    set({ prefs, places, activeId: viewed.activeId, peek: viewed.peek, here, hydrated: true });
  },
  loadActive: async (force, signal) => {
    const generation = ++activeLoadGeneration;
    const peek = get().peek;
    const place =
      get().places.find((p) => p.id === get().activeId) ?? (peek && peek.id === get().activeId ? peek : undefined);
    if (!place) return;
    const cached = readCacheFile().entries[place.id];
    const fresh = !!cached && cached.bundle.marineVersion === 1 &&
      Date.now() - cached.at < CACHE_TTL_MS && !force;
    if (fresh && cached) {
      if (signal?.aborted || generation !== activeLoadGeneration || get().activeId !== place.id) return;
      set({ bundle: cached.bundle, stale: false, estimated: false, loading: false, error: false });
      return;
    }
    const current = get().bundle;
    if (!current || current.placeId !== place.id) {
      // Show a real cached forecast during refresh; estimate only when the city has no cache.
      set({ bundle: cached?.bundle ?? estimateBundle(place), estimated: !cached, stale: true, loading: true, error: false });
    } else {
      set({ loading: true, error: false });
    }
    try {
      const res = await loadWeather(place, { force, signal });
      if (signal?.aborted || generation !== activeLoadGeneration) return;
      if (get().activeId !== place.id) return;
      set({ bundle: res.bundle, stale: res.stale, estimated: res.estimated, loading: false, error: false });
    } catch (err) {
      if (signal?.aborted || generation !== activeLoadGeneration || (err instanceof DOMException && err.name === "AbortError")) return;
      if (get().activeId !== place.id) return;
      set({ loading: false, error: !get().bundle });
    }
  },
  setActive: (id) => {
    if (id !== get().activeId) ++activeLoadGeneration;
    const place = get().places.find(p => p.id === id);
    if (!place) return;
    saveLastViewed(place);
    set({ activeId: id, peek: null });
    persistPlaces(get().places, id);
  },
  viewPlace: (place) => {
    const saved = get().places.find((p) => sameSpot(p, place));
    if (saved) {
      get().setActive(saved.id);
      return;
    }
    saveLastViewed(place);
    set({ peek: place, activeId: place.id, revision: get().revision + 1 });
  },
  locatePlace: (place) => {
    const saved = get().places.find((p) => sameSpot(p, place));
    if (saved) {
      get().setActive(saved.id);
      return;
    }
    // Persist last selected GPS preview without ever adding it to saved cities.
    // Only explicit save/delete actions may change the persisted list.
    saveLastViewed(place);
    set({ peek: place, activeId: place.id, revision: get().revision + 1 });
  },
  setHere: (place) => {
    saveHere(place);
    set({ here: place });
  },
  addPlace: (place, replaceId, opts) => {
    const activate = opts?.activate !== false;
    const places = get().places.slice();
    let idx = replaceId ? places.findIndex((p) => p.id === replaceId) : -1;
    if (idx < 0) idx = places.findIndex((p) => p.id === place.id);
    if (idx >= 0) {
      const prev = places[idx]!;
      const moved = prev.id !== place.id || Math.abs(prev.lat - place.lat) > 0.0004 || Math.abs(prev.lon - place.lon) > 0.0004;
      const activeId = activate ? place.id : get().activeId;
      const activeChanged = activeId !== get().activeId;
      places[idx] = { ...prev, ...place, primary: prev.primary };
      set({
        places,
        activeId,
        peek: get().peek?.id === place.id ? null : get().peek,
        revision: activate && (moved || activeChanged) ? get().revision + 1 : get().revision,
      });
      if (activate) saveLastViewed(places[idx]!);
      persistPlaces(places, places.some((p) => p.id === activeId) ? activeId : prev.id);
      return;
    }
    const next = [...places, { ...place, primary: places.length === 0 }];
    while (next.length > MAX_CACHED_PLACES) {
      const drop = next.findIndex((p) => !p.primary && p.id !== place.id);
      if (drop < 0) break;
      next.splice(drop, 1);
    }
    const activeId = activate ? place.id : get().activeId;
    const keep = next.some((p) => p.id === activeId) ? activeId : (next.find((p) => p.primary)?.id ?? next[0]!.id);
    set({
      places: next,
      activeId: keep,
      peek: get().peek?.id === place.id ? null : get().peek,
      revision: activate ? get().revision + 1 : get().revision,
    });
    if (activate) saveLastViewed(next.find((p) => p.id === keep) ?? null);
    persistPlaces(next, keep);
  },
  removePlace: (id) => {
    let places = get().places.filter((p) => p.id !== id);
    if (!places.length) places = [MUSCAT];
    if (!places.some((p) => p.primary)) places = places.map((p, i) => ({ ...p, primary: i === 0 }));
    const removedActive = get().activeId === id;
    const activeId = removedActive ? (places.find((p) => p.primary)?.id ?? places[0]!.id) : get().activeId;
    if (removedActive) saveLastViewed(places.find(p => p.id === activeId) ?? null);
    set({ places, activeId, revision: removedActive ? get().revision + 1 : get().revision });
    persistPlaces(places, activeId);
  },
  movePlace: (id, dir) => {
    const places = get().places.slice();
    const i = places.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= places.length) return;
    const tmp = places[i]!;
    places[i] = places[j]!;
    places[j] = tmp;
    set({ places });
    persistPlaces(places, get().activeId);
  },
  makePrimary: (id) => {
    const places = get().places.map((p) => ({ ...p, primary: p.id === id }));
    saveLastViewed(places.find(p => p.id === id) ?? null);
    set({ places, activeId: id, revision: id === get().activeId ? get().revision : get().revision + 1 });
    persistPlaces(places, id);
  },
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    if (patch.mapHours && patch.mapHours !== 24 && patch.mapHours !== 48 && patch.mapHours !== 72) return;
    if (typeof patch.storms === "boolean") prefs.stormsSet = true;
    set({ prefs });
    savePrefs(prefs);
  },
  clearCache: () => {
    ++activeLoadGeneration;
    clearBundles();
    // Clearing disk cache must not blank the forecast already on screen.
    set({ notice: "cleared", stale: !!get().bundle, loading: false, revision: get().revision + 1 });
  },
  setNotice: (notice) => set({ notice }),
}));

export function activePlace(state: Pick<WeatherState, "places" | "activeId"> & Partial<Pick<WeatherState, "peek">>): Place {
  const saved = state.places.find((p) => p.id === state.activeId);
  if (saved) return saved;
  if (state.peek && state.peek.id === state.activeId) return state.peek;
  return state.places[0] ?? MUSCAT;
}

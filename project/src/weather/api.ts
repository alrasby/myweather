import { daylightNow } from "@/weather/astro";
import { dayKey } from "@/weather/format";
import { markQuota } from "@/weather/grid";
import { proxyFetch } from "@/weather/net";
import { normalizePlaceQuery, searchLocal } from "@/weather/places-index";
import { CACHE_KEY, CACHE_TTL_MS, MAX_CACHED_PLACES, type Place, type WeatherBundle } from "@/weather/types";

type CacheEntry = { at: number; bundle: WeatherBundle };

export type CacheFile = {
  places: Place[];
  activeId: string;
  entries: Record<string, CacheEntry>;
};

const inflight = new Map<string, Promise<{ bundle: WeatherBundle; stale: boolean; estimated: boolean }>>();

function emptyCache(): CacheFile {
  return { places: [], activeId: "", entries: {} };
}

export function readCacheFile(): CacheFile {
  if (typeof localStorage === "undefined") return emptyCache();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    return {
      places: Array.isArray(parsed.places) ? parsed.places.slice(0, MAX_CACHED_PLACES) : [],
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : "",
      entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
    };
  } catch {
    return emptyCache();
  }
}

export function writeCacheFile(file: CacheFile) {
  if (typeof localStorage === "undefined") return;
  try {
    const entries: Record<string, CacheEntry> = {};
    const kept = Object.entries(file.entries)
      .filter(([, entry]) => entry?.bundle && Number.isFinite(entry.bundle.current?.temp))
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_CACHED_PLACES);
    for (const [id, entry] of kept) entries[id] = entry;
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        places: file.places.slice(0, MAX_CACHED_PLACES),
        activeId: file.activeId,
        entries,
      }),
    );
  } catch {
    /* التخزين ممتلئ */
  }
}

export function clearBundles() {
  const file = readCacheFile();
  file.entries = {};
  writeCacheFile(file);
}

function rememberBundle(id: string, bundle: WeatherBundle) {
  const file = readCacheFile();
  file.entries[id] = { at: Date.now(), bundle };
  writeCacheFile(file);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

/** وقت Open-Meteo: إن كان بلا منطقة نطرح إزاحة المنطقة بعد قراءته كأنه UTC. */
function parseWall(value: string | number | undefined, offsetSec: number): number {
  if (typeof value === "number") return value * 1000;
  if (value && /^\d{10}(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  if (!value) return NaN;
  if (value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value)) return Date.parse(value);
  const utc = Date.parse(`${value}Z`);
  return Number.isFinite(utc) ? utc - offsetSec * 1000 : NaN;
}

function buildBundle(
  place: Place,
  json: Record<string, unknown>,
  air: WeatherBundle["air"],
  marine: WeatherBundle["marine"],
): WeatherBundle {
  const offset = num(json.utc_offset_seconds, 0);
  const timezone = typeof json.timezone === "string" && json.timezone ? json.timezone : "UTC";
  const hourly = (json.hourly ?? {}) as Record<string, unknown>;
  const times = Array.isArray(hourly.time) ? (hourly.time as (string | number)[]) : [];
  const hourRows = times.map((stamp, i) => ({
    t: parseWall(stamp, offset),
    temp: finite((hourly.temperature_2m as number[] | undefined)?.[i]),
    precip: finite((hourly.precipitation as number[] | undefined)?.[i]),
    pop: finite((hourly.precipitation_probability as number[] | undefined)?.[i]),
    code: num((hourly.weather_code as number[] | undefined)?.[i]),
    wind: num((hourly.wind_speed_10m as number[] | undefined)?.[i]),
    gust: num((hourly.wind_gusts_10m as number[] | undefined)?.[i]),
    feels: num((hourly.apparent_temperature as number[] | undefined)?.[i]),
    uv: num((hourly.uv_index as number[] | undefined)?.[i]),
    isDay: num((hourly.is_day as number[] | undefined)?.[i]) === 1,
    pressure: num((hourly.pressure_msl as number[] | undefined)?.[i]),
  }));
  const daily = (json.daily ?? {}) as Record<string, unknown>;
  const dayTimes = Array.isArray(daily.time) ? (daily.time as (string | number)[]) : [];
  const dayRows = dayTimes.map((stamp, i) => ({
    t: typeof stamp === "number" ? stamp * 1000 + 12 * 3600000 : parseWall(`${stamp}T12:00`, offset),
    code: num((daily.weather_code as number[] | undefined)?.[i]),
    tmax: finite((daily.temperature_2m_max as number[] | undefined)?.[i]),
    tmin: finite((daily.temperature_2m_min as number[] | undefined)?.[i]),
    sunrise: parseWall(String((daily.sunrise as string[] | undefined)?.[i] ?? ""), offset),
    sunset: parseWall(String((daily.sunset as string[] | undefined)?.[i] ?? ""), offset),
    precip: finite((daily.precipitation_sum as number[] | undefined)?.[i]),
    pop: finite((daily.precipitation_probability_max as number[] | undefined)?.[i]),
    uv: num((daily.uv_index_max as number[] | undefined)?.[i]),
    wind: num((daily.wind_speed_10m_max as number[] | undefined)?.[i]),
  }));
  const current = (json.current ?? {}) as Record<string, unknown>;
  const bundle: WeatherBundle = {
    placeId: place.id,
    timezone,
    offset,
    fetchedAt: Date.now(),
    current: {
      t: parseWall(String(current.time ?? ""), offset) || Date.now(),
      temp: finite(current.temperature_2m),
      feels: finite(current.apparent_temperature),
      humidity: num(current.relative_humidity_2m),
      precip: finite(current.precipitation),
      code: num(current.weather_code),
      cloud: num(current.cloud_cover),
      pressure: num(current.pressure_msl),
      wind: num(current.wind_speed_10m),
      gust: num(current.wind_gusts_10m),
      dir: num(current.wind_direction_10m),
      visibility: num(current.visibility, 10_000),
      isDay: num(current.is_day) === 1,
    },
    hourly: hourRows.filter((row) => Number.isFinite(row.t)),
    daily: dayRows.filter((row) => Number.isFinite(row.t)),
    air,
    marine,
  };
  if (!Number.isFinite(bundle.current.temp)) {
    const now = Date.now();
    let nearest: (typeof bundle.hourly)[number] | null = null;
    let best = Infinity;
    for (const row of bundle.hourly) {
      if (!Number.isFinite(row.temp)) continue;
      const dist = Math.abs(row.t - now);
      if (dist < best) {
        nearest = row;
        best = dist;
      }
    }
    if (nearest && best < 3 * 3_600_000) {
      bundle.current.temp = nearest.temp;
      if (!Number.isFinite(bundle.current.feels)) bundle.current.feels = nearest.feels;
      if (!Number.isFinite(bundle.current.precip)) bundle.current.precip = nearest.precip;
    }
  }
  for (const day of bundle.daily) {
    const key = dayKey(day.t, timezone);
    let sum = 0;
    let count = 0;
    let pop = NaN;
    for (const row of bundle.hourly) {
      if (dayKey(row.t, timezone) !== key) continue;
      if (Number.isFinite(row.precip)) {
        sum += row.precip;
        count += 1;
      }
      if (Number.isFinite(row.pop)) pop = Number.isFinite(pop) ? Math.max(pop, row.pop) : row.pop;
    }
    if (count >= 18) day.precip = Math.round(sum * 10) / 10;
    if (!Number.isFinite(day.pop) && Number.isFinite(pop)) day.pop = pop;
  }
  if (!Number.isFinite(bundle.current.feels)) bundle.current.feels = bundle.current.temp;
  if (!Number.isFinite(bundle.current.precip)) bundle.current.precip = 0;
  bundle.current.isDay = daylightNow(Date.now(), place.lat, place.lon, bundle.daily, bundle.hourly);
  if (!Number.isFinite(bundle.current.temp) || !bundle.daily.length) throw new Error("invalid-weather");
  return bundle;
}

async function fetchAir(place: Place, signal?: AbortSignal): Promise<WeatherBundle["air"]> {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", String(place.lat));
  url.searchParams.set("longitude", String(place.lon));
  url.searchParams.set("current", "us_aqi,pm2_5,pm10,dust");
  url.searchParams.set("hourly", "dust");
  url.searchParams.set("forecast_hours", "48");
  url.searchParams.set("timezone", "auto");
  const res = await proxyFetch(url.toString(), signal, "background");
  if (!res.ok) return null;
  const json = (await res.json()) as {
    utc_offset_seconds?: number;
    current?: { us_aqi?: number | null; pm2_5?: number | null; pm10?: number | null; dust?: number | null };
    hourly?: { time?: string[]; dust?: number[] };
  };
  const offset = json.utc_offset_seconds ?? 0;
  const dustHourly = (json.hourly?.time ?? []).slice(0, 48).map((stamp, i) => ({
    t: parseWall(stamp, offset),
    v: num(json.hourly?.dust?.[i]),
  }));
  const cur = json.current ?? {};
  const orNull = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    aqi: orNull(cur.us_aqi),
    pm25: orNull(cur.pm2_5),
    pm10: orNull(cur.pm10),
    dust: orNull(cur.dust),
    dustHourly,
  };
}

async function fetchMarine(place: Place, signal?: AbortSignal): Promise<NonNullable<WeatherBundle["marine"]>> {
  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", String(place.lat));
  url.searchParams.set("longitude", String(place.lon));
  url.searchParams.set("current", "wave_height");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", "auto");
  const res = await proxyFetch(url.toString(), signal, "background");
  if (!res.ok) return { coastal: false, wave: null };
  const json = (await res.json()) as { current?: { wave_height?: number } };
  const wave = json.current?.wave_height;
  return typeof wave === "number" && Number.isFinite(wave) ? { coastal: true, wave } : { coastal: false, wave: null };
}

async function fetchForecast(place: Place, signal?: AbortSignal): Promise<WeatherBundle> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.lat));
  url.searchParams.set("longitude", String(place.lon));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility",
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,apparent_temperature,uv_index,is_day,pressure_msl",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,uv_index_max,wind_speed_10m_max",
  );
  url.searchParams.set("forecast_days", "15");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("cell_selection", "land");
  const res = await proxyFetch(url.toString(), signal);
  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    if (/daily (api )?request limit|daily limit exceeded/i.test(body)) markQuota(30 * 60_000);
    console.warn("[MyWeather forecast] HTTP 429", body.slice(0, 500));
    throw new Error("quota");
  }
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) {
    const reason = String((json as { reason?: unknown }).reason ?? "");
    if (/daily (api )?request limit|daily limit exceeded/i.test(reason)) markQuota(30 * 60_000);
    throw new Error(reason || "forecast");
  }
  const cached = readCacheFile().entries[place.id]?.bundle;
  return buildBundle(place, json, cached?.air ?? null, cached?.marine ?? {coastal:false,wave:null});
}

function aborted(err: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (err instanceof DOMException && err.name === "AbortError");
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function loadWeather(
  place: Place,
  opts?: { force?: boolean; signal?: AbortSignal },
): Promise<{ bundle: WeatherBundle; stale: boolean; estimated: boolean }> {
  const key = `${place.id}|${opts?.force ? "f" : "c"}`;
  // طلب مربوط بإشارة إلغاء لا يُشارَك: تبديل المدينة يلغي الأول، والثاني يجب أن يبدأ من جديد.
  if (!opts?.signal) {
    const existing = inflight.get(key);
    if (existing) return existing;
  }
  const job = (async () => {
    const cached = readCacheFile().entries[place.id];
    const fresh = !!cached && Date.now() - cached.at < CACHE_TTL_MS;
    if (cached && fresh && !opts?.force) return { bundle: cached.bundle, stale: false, estimated: false };
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (opts?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        const bundle = await fetchForecast(place, opts?.signal);
        rememberBundle(place.id, bundle);
        return { bundle, stale: false, estimated: false };
      } catch (err) {
        if (aborted(err, opts?.signal)) throw err;
        last = err;
        if (err instanceof Error && err.message === "quota") break;
        if (attempt < 1) {
          try {
            await pause(500 * (attempt + 1), opts?.signal);
          } catch (waitErr) {
            if (aborted(waitErr, opts?.signal)) throw waitErr;
          }
        }
      }
    }
    if (cached) return { bundle: cached.bundle, stale: true, estimated: false };
    throw last instanceof Error ? last : new Error("connection");
  })();
  if (!opts?.signal) {
    inflight.set(key, job);
    void job.then(() => {
      if (inflight.get(key) === job) inflight.delete(key);
    }, () => { if (inflight.get(key) === job) inflight.delete(key); });
  }
  return job;
}

function searchLangs(query: string, lang: string): string[] {
  const arabic = /[\u0600-\u06FF]/.test(query);
  const first = arabic ? "ar" : lang || "en";
  const second = arabic ? "en" : "ar";
  return first === second ? [first] : [first, second];
}

async function geocode(name: string, language: string, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", language);
  const res = await proxyFetch(url.toString(), signal);
  if (!res.ok) return [];
  const text = (await res.text()).trim();
  if (!text || text.startsWith("<") || text.startsWith("<!")) return [];
  let json = JSON.parse(text) as { results?: Array<Record<string, unknown>> } | string;
  if (typeof json === "string") {
    try {
      json = JSON.parse(json) as { results?: Array<Record<string, unknown>> };
    } catch {
      return [];
    }
  }
  return (json.results ?? []).map((row) => {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    return {
      id: `${lat.toFixed(2)},${lon.toFixed(2)}`,
      name: String(row.name ?? ""),
      nameEn: language === "en" ? String(row.name ?? "") : undefined,
      country: String(row.country ?? row.country_code ?? ""),
      countryEn: language === "en" ? String(row.country ?? "") : undefined,
      admin: String(row.admin1 ?? ""),
      lat,
      lon,
      primary: false,
    };
  });
}

function mergePlaces(local: Place[], remote: Place[]): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  const key = (place: Place) => `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
  for (const place of [...local, ...remote]) {
    const id = key(place);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(place);
    if (out.length >= 12) break;
  }
  return out;
}

export async function searchPlaces(query: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const local = searchLocal(trimmed);
  const forms = [trimmed];
  const folded = normalizePlaceQuery(trimmed);
  if (folded && folded !== trimmed) forms.push(folded);
  const jobs: Promise<Place[]>[] = [];
  for (const form of forms) {
    for (const language of searchLangs(form, lang)) {
      jobs.push(
        geocode(form, language, signal).catch((err) => {
          if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
          return [];
        }),
      );
    }
  }
  const remote = (await Promise.all(jobs)).flat();
  return mergePlaces(local, remote);
}

export function placeFromCoords(lat: number, lon: number, name: string, country = "", admin = ""): Place {
  return {
    id: `${lat.toFixed(3)},${lon.toFixed(3)}`,
    name,
    country,
    admin,
    lat,
    lon,
    primary: false,
  };
}

export async function enrichWeather(place: Place, bundle: WeatherBundle, signal?: AbortSignal): Promise<WeatherBundle> {
  const [air, marine] = await Promise.all([
    fetchAir(place, signal).catch(() => bundle.air),
    fetchMarine(place, signal).catch(() => bundle.marine ?? {coastal:false,wave:null}),
  ]);
  if (signal?.aborted) throw new DOMException('aborted','AbortError');
  const next = {...bundle, air, marine};
  rememberBundle(place.id, next);
  return next;
}

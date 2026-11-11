import { daylightNow, solarDaylight } from "@/weather/astro";
import { estimateBundle } from "@/weather/estimate";
import { repairSolarForecast, solarEventsForDate } from "@/weather/solarForecast";
import { dayKey } from "@/weather/format";
import { isQuotaBlocked, markQuota } from "@/weather/grid";
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
    const places = Array.isArray(parsed.places) ? parsed.places.slice(0, MAX_CACHED_PLACES) : [];
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    // Repair legacy MET.no solar times in place without invalidating the
    // cache key, saved cities, settings, or other weather values on upgrades.
    const corrected: Record<string, CacheEntry> = {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!entry?.bundle || !Number.isFinite(entry.at)) continue;
      const place = places.find((item) => item.id === id);
      corrected[id] = place ? { ...entry, bundle: repairSolarForecast(entry.bundle, place) } : entry;
    }
    return {
      places,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : "",
      entries: corrected,
    };
  } catch {
    return emptyCache();
  }
}

export function writeCacheFile(file: CacheFile) {
  if (typeof localStorage === "undefined") return;
  try {
    const ids = new Set(file.places.map((place) => place.id));
    const entries: Record<string, CacheEntry> = {};
    const kept = Object.entries(file.entries)
      .filter(([id]) => ids.has(id))
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
function parseWall(value: string | undefined, offsetSec: number): number {
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
  const times = Array.isArray(hourly.time) ? (hourly.time as string[]) : [];
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
  const dayTimes = Array.isArray(daily.time) ? (daily.time as string[]) : [];
  const dayRows = dayTimes.map((stamp, i) => ({
    t: parseWall(`${stamp}T12:00`, offset),
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
  const res = await proxyFetch(url.toString(), signal);
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
  // Do not accidentally select inland cells for coastal towns.
  url.searchParams.set("cell_selection", "sea");
  const res = await proxyFetch(url.toString(), signal);
  if (!res.ok) return { coastal: false, wave: null };
  const json = (await res.json()) as { latitude?: number; longitude?: number; current?: { wave_height?: number } };
  const wave = json.current?.wave_height;
  // A successful sea-grid response can identify the coast even when wave height
  // is missing. Bound the distance to avoid marking far-inland towns as coastal.
  const gridLat = json.latitude;
  const gridLon = json.longitude;
  let nearSea = false;
  if (typeof gridLat === "number" && Number.isFinite(gridLat) &&
      typeof gridLon === "number" && Number.isFinite(gridLon)) {
    const dLat = (gridLat - place.lat) * Math.PI / 180;
    const dLon = (gridLon - place.lon) * Math.PI / 180;
    const lat1 = place.lat * Math.PI / 180;
    const lat2 = gridLat * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    nearSea = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a))) <= 30;
  }
  return { coastal: nearSea, wave: nearSea && typeof wave === "number" && Number.isFinite(wave) ? wave : null };
}

async function fetchOpenMeteo(place: Place, signal?: AbortSignal): Promise<WeatherBundle> {
  if (isQuotaBlocked()) throw new Error("quota");
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
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("cell_selection", "land");
  const res = await proxyFetch(url.toString(), signal);
  if (res.status === 429) {
    const body = await res.text().catch(() => "");
    if (/daily (api )?request limit|daily limit exceeded/i.test(body)) markQuota(30 * 60_000);
    throw new Error("quota");
  }
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) {
    const reason = String((json as { reason?: unknown }).reason ?? "");
    if (/daily (api )?request limit|daily limit exceeded/i.test(reason)) markQuota(30 * 60_000);
    throw new Error(reason || "forecast");
  }
  const [air, marine] = await Promise.all([
    fetchAir(place, signal).catch(() => null),
    fetchMarine(place, signal).catch(() => ({ coastal: false, wave: null })),
  ]);
  return buildBundle(place, json, air, marine);
}

const MET_UA = "MyWeather/1.0 (net.nabdhserv.myweather)";

type MetDetails = {
  air_pressure_at_sea_level?: number;
  air_temperature?: number;
  cloud_area_fraction?: number;
  relative_humidity?: number;
  wind_from_direction?: number;
  wind_speed?: number;
  precipitation_amount?: number;
};

type MetData = {
  instant?: { details?: MetDetails };
  next_1_hours?: { summary?: { symbol_code?: string }; details?: MetDetails };
  next_6_hours?: { summary?: { symbol_code?: string }; details?: MetDetails };
  next_12_hours?: { summary?: { symbol_code?: string }; details?: MetDetails };
};

function zoneFromLon(lon: number): { timezone: string; offset: number } {
  const offsetHours = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  const offset = offsetHours * 3600;
  const timezone = offsetHours === 0 ? "UTC" : `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
  return { timezone, offset };
}

function wmoFromSymbol(symbol: string): number {
  const s = symbol.toLowerCase().replace(/_(day|night|polartwilight)$/g, "");
  const table: Record<string, number> = {
    clearsky: 0,
    fair: 1,
    partlycloudy: 2,
    cloudy: 3,
    fog: 45,
    lightrainshowers: 80,
    rainshowers: 81,
    heavyrainshowers: 82,
    lightrain: 61,
    rain: 63,
    heavyrain: 65,
    lightsleetshowers: 56,
    sleetshowers: 67,
    heavysleetshowers: 68,
    lightsleet: 56,
    sleet: 67,
    heavysleet: 68,
    lightsnow: 71,
    snow: 73,
    heavysnow: 75,
    lightsnowshowers: 85,
    snowshowers: 86,
    heavysnowshowers: 86,
    lightrainshowersandthunder: 95,
    rainshowersandthunder: 95,
    heavyrainshowersandthunder: 99,
    lightrainandthunder: 95,
    rainandthunder: 95,
    heavyrainandthunder: 99,
    lightsnowandthunder: 95,
    snowandthunder: 95,
  };
  if (s in table) return table[s]!;
  if (s.includes("thunder")) return 95;
  if (s.includes("snow")) return 73;
  if (s.includes("sleet")) return 67;
  if (s.includes("rain")) return 63;
  if (s.includes("fog")) return 45;
  if (s.includes("cloud")) return 3;
  return 2;
}

function metSymbol(data: MetData): string {
  return data.next_1_hours?.summary?.symbol_code || data.next_6_hours?.summary?.symbol_code || data.next_12_hours?.summary?.symbol_code || "";
}

function metPeriodMm(data: MetData, stepH: number): number {
  const one = data.next_1_hours?.details?.precipitation_amount;
  const six = data.next_6_hours?.details?.precipitation_amount;
  const twelve = data.next_12_hours?.details?.precipitation_amount;
  const raw = stepH <= 2 ? (one ?? six ?? twelve) : stepH <= 8 ? (six ?? twelve ?? one) : (twelve ?? six ?? one);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

function feelsLike(temp: number, rh: number, windKmh: number): number {
  if (temp >= 27 && rh >= 40) {
    const hi =
      -8.7847 +
      1.6114 * temp +
      2.3385 * rh -
      0.1461 * temp * rh -
      0.0123 * temp * temp -
      0.0164 * rh * rh +
      0.0022 * temp * temp * rh +
      0.0007 * temp * rh * rh -
      0.00000358 * temp * temp * rh * rh;
    if (Number.isFinite(hi)) return Math.round(hi * 10) / 10;
  }
  return Math.round(temp * 10) / 10;
}

function clearUv(lat: number, ms: number): number {
  const start = Date.UTC(new Date(ms).getUTCFullYear(), 0, 0);
  const doy = Math.floor((ms - start) / 86_400_000);
  const decl = 23.44 * Math.cos((2 * Math.PI * (doy - 172)) / 365);
  return Math.max(0, Math.round(10 * Math.cos(((lat - decl) * Math.PI) / 180)));
}

/** مصدر ثانٍ عندما يرفض Open-Meteo الطلب أو ينقطع. الأرقام حقيقية وليست تقديرًا مناخيًا. */
async function fetchMet(place: Place, signal?: AbortSignal): Promise<WeatherBundle> {
  const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/compact");
  url.searchParams.set("lat", place.lat.toFixed(4));
  url.searchParams.set("lon", place.lon.toFixed(4));
  const res = await proxyFetch(url.toString(), signal, { "User-Agent": MET_UA });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = (await res.json()) as { properties?: { timeseries?: { time: string; data?: MetData }[] } };
  const series = json.properties?.timeseries ?? [];
  if (!series.length) throw new Error("met-empty");
  const { timezone, offset } = zoneFromLon(place.lon);
  const times = series.map((row) => Date.parse(row.time));
  const slots = series.flatMap((row, i) => {
    const t = times[i] ?? NaN;
    if (!Number.isFinite(t)) return [];
    const details = row.data?.instant?.details ?? {};
    const temp = num(details.air_temperature);
    const rh = num(details.relative_humidity);
    const wind = num(details.wind_speed) * 3.6;
    const next = times[i + 1];
    const stepH = Number.isFinite(next) ? Math.max(1, Math.round(((next as number) - t) / 3_600_000)) : 1;
    const period = metPeriodMm(row.data ?? {}, stepH);
    const precip = period / stepH;
    return [
      {
        period,
        hour: {
          t,
          temp,
          precip,
          pop: precip >= 0.3 ? 70 : precip > 0 ? 35 : 0,
          code: wmoFromSymbol(metSymbol(row.data ?? {})),
          wind,
          gust: wind * 1.35,
          feels: feelsLike(temp, rh, wind),
          uv: solarDaylight(place.lat, place.lon, t) ? clearUv(place.lat, t) : 0,
          isDay: solarDaylight(place.lat, place.lon, t),
          pressure: num(details.air_pressure_at_sea_level),
        },
      },
    ];
  });
  if (!slots.length) throw new Error("met-empty");
  const hourly = slots.map((slot) => slot.hour);
  const byDay = new Map<string, typeof slots>();
  for (const slot of slots) {
    const key = dayKey(slot.hour.t, timezone);
    const list = byDay.get(key);
    if (list) list.push(slot);
    else byDay.set(key, [slot]);
  }
  const daily = [...byDay.entries()].map(([key, rows]) => {
    const noon = Date.parse(`${key}T12:00:00Z`) - offset * 1000;
    const temps = rows.map((row) => row.hour.temp);
    const precip = rows.reduce((sum, row) => sum + row.period, 0);
    const mid = rows.reduce((best, row) => (Math.abs(row.hour.t - noon) < Math.abs(best.hour.t - noon) ? row : best));
    // sunArc's argument is UTC noon of the city's calendar DATE.
    // 'noon' above is already timezone-adjusted local noon. Passing it to
    // sunArc shifted sunrise/sunset by the UTC offset a second time.
    const sun = solarEventsForDate(key, place.lat, place.lon);
    return {
      t: noon,
      code: mid.hour.code,
      tmax: Math.max(...temps),
      tmin: Math.min(...temps),
      sunrise: sun.rise,
      sunset: sun.set,
      precip: Math.round(precip * 10) / 10,
      pop: Math.max(...rows.map((row) => row.hour.pop)),
      uv: clearUv(place.lat, noon),
      wind: Math.max(...rows.map((row) => row.hour.wind)),
    };
  });
  const now = Date.now();
  const nearest = hourly.reduce((best, row) => (Math.abs(row.t - now) < Math.abs(best.t - now) ? row : best));
  const instant = series[0]?.data?.instant?.details ?? {};
  return {
    placeId: place.id,
    timezone,
    offset,
    fetchedAt: now,
    current: {
      t: nearest.t,
      temp: nearest.temp,
      feels: nearest.feels,
      humidity: Math.round(num(instant.relative_humidity)),
      precip: nearest.precip,
      code: nearest.code,
      cloud: num(instant.cloud_area_fraction),
      pressure: num(instant.air_pressure_at_sea_level),
      wind: nearest.wind,
      gust: nearest.gust,
      dir: num(instant.wind_from_direction),
      visibility: 10_000,
      isDay: daylightNow(now, place.lat, place.lon, daily, hourly),
    },
    hourly,
    daily,
    air: null,
    marine: null,
  };
}

async function fetchForecast(place: Place, signal?: AbortSignal): Promise<WeatherBundle> {
  let primary: unknown;
  if (!isQuotaBlocked()) {
    try {
      return await fetchOpenMeteo(place, signal);
    } catch (err) {
      if (aborted(err, signal)) throw err;
      primary = err;
    }
  }
  try {
    return await fetchMet(place, signal);
  } catch (err) {
    if (aborted(err, signal)) throw err;
    throw primary instanceof Error ? primary : err;
  }
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
    for (let attempt = 0; attempt < 3; attempt++) {
      if (opts?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        const bundle = await fetchForecast(place, opts?.signal);
        rememberBundle(place.id, bundle);
        return { bundle, stale: false, estimated: false };
      } catch (err) {
        if (aborted(err, opts?.signal)) throw err;
        last = err;
        if (attempt < 2) {
          try {
            await pause(500 * (attempt + 1), opts?.signal);
          } catch (waitErr) {
            if (aborted(waitErr, opts?.signal)) throw waitErr;
          }
        }
      }
    }
    if (cached) return { bundle: cached.bundle, stale: true, estimated: false };
    if (last instanceof Error && last.message === "quota") return { bundle: estimateBundle(place), stale: true, estimated: true };
    return { bundle: estimateBundle(place), stale: true, estimated: true };
  })();
  if (!opts?.signal) {
    inflight.set(key, job);
    void job.finally(() => {
      if (inflight.get(key) === job) inflight.delete(key);
    });
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

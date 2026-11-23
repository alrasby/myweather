import type { ReverseHit } from "@/weather/reverse.functions";

function speech(lang: string): string {
  const code = (lang || "en").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}

async function fromNominatim(lat: number, lon: number, lang: string, signal: AbortSignal): Promise<ReverseHit> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "14");
  url.searchParams.set("accept-language", speech(lang));
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) return null;
  const json = (await res.json()) as { address?: Record<string, string | undefined> };
  const address = json.address ?? {};
  const name =
    address.suburb ||
    address.neighbourhood ||
    address.quarter ||
    address.village ||
    address.hamlet ||
    address.town ||
    address.city ||
    address.municipality ||
    "";
  if (!name) return null;
  return {
    name,
    admin: address.county || address.state || address.city || "",
    country: address.country || "",
  };
}

async function fromBigData(lat: number, lon: number, lang: string, signal: AbortSignal): Promise<ReverseHit> {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", speech(lang));
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  const name = json.locality || json.city || "";
  if (!name) return null;
  return {
    name,
    admin: json.city && json.city !== name ? json.city : json.principalSubdivision || "",
    country: json.countryName || "",
  };
}

type NamedPoint = { lat: number; lon: number; language: string; at: number; value: NonNullable<ReverseHit> };
const NAME_CACHE_KEY = "myweather-place-names-v1";
const NAME_CACHE_AGE = 7 * 24 * 60 * 60_000;
const placeNames = new Map<string, NamedPoint>();
const pendingNames = new Map<string, Promise<ReverseHit>>();
let namesRestored = false;

export function hasPlaceName(name: string): boolean {
  return !!name.trim() && !["موقعي", "My location"].includes(name.trim()) &&
    !/^[\p{N}\s.,،+−-]+$/u.test(name);
}

function restoreNames(): void {
  if (namesRestored) return;
  namesRestored = true;
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(NAME_CACHE_KEY) || "[]");
    if (!Array.isArray(rows)) return;
    for (const row of rows.slice(-32)) {
      const point = row as NamedPoint | null;
      if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
          !Number.isFinite(point.lon) || Math.abs(point.lon) > 180 ||
          !Number.isFinite(point.at) || point.at > Date.now() || Date.now() - point.at > NAME_CACHE_AGE ||
          typeof point.language !== "string" || !/^[a-z]{2}$/.test(point.language) ||
          typeof point.value?.name !== "string" || !hasPlaceName(point.value.name) || point.value.name.length > 200 ||
          typeof point.value.admin !== "string" || point.value.admin.length > 200 ||
          typeof point.value.country !== "string" || point.value.country.length > 200) continue;
      const key = `${point.lat.toFixed(3)},${point.lon.toFixed(3)}|${point.language}`;
      placeNames.set(key, point);
    }
  } catch { /* Restricted or damaged storage must not block naming. */ }
}

/** Reuse a real named point within 350 metres, including after app restart. */
export function cachedPlaceName(lat: number, lon: number, lang = "ar"): ReverseHit {
  restoreNames();
  let distance = 0.35;
  let result: ReverseHit = null;
  for (const point of placeNames.values()) {
    if (point.language !== speech(lang) || Date.now() - point.at > NAME_CACHE_AGE) continue;
    const km = Math.hypot((point.lat - lat) * 111,
      (point.lon - lon) * 111 * Math.cos(lat * Math.PI / 180));
    if (km < distance) { distance = km; result = point.value; }
  }
  return result;
}

/** A healthy provider can name the point while the other provider is stalled. */
export async function lookupPlace(lat: number, lon: number, lang = "ar"): Promise<ReverseHit> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const cached = cachedPlaceName(lat, lon, lang);
  if (cached) return cached;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}|${speech(lang)}`;
  const pending = pendingNames.get(key);
  if (pending) return pending;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, 8000);
  });
  const usable = async (provider: Promise<ReverseHit>): Promise<NonNullable<ReverseHit>> => {
    const value = await provider;
    if (!value || typeof value.name !== "string" || !hasPlaceName(value.name)) throw new Error("place-name-unavailable");
    return value;
  };
  const firstName = Promise.any([
    usable(fromNominatim(lat, lon, lang, controller.signal)),
    usable(fromBigData(lat, lon, lang, controller.signal)),
  ]).catch(() => null);
  const work = Promise.race([firstName, deadline]).then((value) => {
    if (value) {
      placeNames.delete(key);
      placeNames.set(key, { lat, lon, language: speech(lang), at: Date.now(), value });
      if (placeNames.size > 32) placeNames.delete(placeNames.keys().next().value!);
      try { localStorage.setItem(NAME_CACHE_KEY, JSON.stringify([...placeNames.values()])); }
      catch { /* The bounded memory cache also works without disk storage. */ }
    }
    return value;
  }).finally(() => {
    clearTimeout(timer!);
    controller.abort();
    pendingNames.delete(key);
  });
  pendingNames.set(key, work);
  return work;
}

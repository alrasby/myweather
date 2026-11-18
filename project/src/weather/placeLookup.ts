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

const placeNames = new Map<string, { at: number; value: NonNullable<ReverseHit> }>();
const pendingNames = new Map<string, Promise<ReverseHit>>();

/** Keep successful measured-point names through transient outages. */
export async function lookupPlace(lat: number, lon: number, lang = "ar"): Promise<ReverseHit> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}|${speech(lang)}`;
  const cached = placeNames.get(key);
  if (cached && Date.now() - cached.at < 24 * 60 * 60_000) return cached.value;
  const pending = pendingNames.get(key);
  if (pending) return pending;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null); }, 8000);
  });
  const work = Promise.all([
    Promise.race([fromNominatim(lat, lon, lang, controller.signal).catch(() => null), deadline]),
    Promise.race([fromBigData(lat, lon, lang, controller.signal).catch(() => null), deadline]),
  ]).then(([precise, fast]) => {
    const value = precise || fast;
    if (value) {
      placeNames.set(key, { at: Date.now(), value });
      if (placeNames.size > 64) placeNames.delete(placeNames.keys().next().value!);
    }
    return value;
  }).finally(() => {
    clearTimeout(timer!);
    pendingNames.delete(key);
  });
  pendingNames.set(key, work);
  return work;
}

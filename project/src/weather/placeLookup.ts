import { proxyFetch } from "@/weather/net";
import type { ReverseHit } from "@/weather/reverse.functions";

function speech(lang: string): string {
  const code = (lang || "en").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}

async function fromNominatim(
  lat: number,
  lon: number,
  lang: string,
  signal: AbortSignal,
): Promise<ReverseHit> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "14");
  url.searchParams.set("accept-language", speech(lang));
  const res = await proxyFetch(url.toString(), signal);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    address?: Record<string, string | undefined>;
  };
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

async function fromBigData(
  lat: number,
  lon: number,
  lang: string,
  signal: AbortSignal,
): Promise<ReverseHit> {
  const url = new URL(
    "https://api.bigdatacloud.net/data/reverse-geocode-client",
  );
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", speech(lang));
  const res = await proxyFetch(url.toString(), signal);
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
    admin:
      json.city && json.city !== name
        ? json.city
        : json.principalSubdivision || "",
    country: json.countryName || "",
  };
}

/** اسم أدق مكان: حي أو بلدة، مباشرة من الإحداثيات، لأي بقعة في العالم. */
export async function lookupPlace(
  lat: number,
  lon: number,
  lang = "ar",
): Promise<ReverseHit> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const [precise, fast] = await Promise.all([
      fromNominatim(lat, lon, lang, controller.signal).catch(() => null),
      fromBigData(lat, lon, lang, controller.signal).catch(() => null),
    ]);
    return precise || fast;
  } finally {
    clearTimeout(timer);
  }
}

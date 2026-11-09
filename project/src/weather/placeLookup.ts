import type { ReverseHit } from "@/weather/reverse.functions";

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function speech(lang: string): string {
  const code = (lang || "en").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : "en";
}

async function fromNominatim(lat: number, lon: number, lang: string): Promise<ReverseHit> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "14");
  url.searchParams.set("accept-language", speech(lang));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
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

async function fromBigData(lat: number, lon: number, lang: string): Promise<ReverseHit> {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", speech(lang));
  const res = await fetch(url);
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

/** اسم أدق مكان: حي أو بلدة، مباشرة من الإحداثيات، لأي بقعة في العالم. */
export async function lookupPlace(lat: number, lon: number, lang = "ar"): Promise<ReverseHit> {
  const [precise, fast] = await Promise.all([
    withTimeout(fromNominatim(lat, lon, lang), 2800).catch(() => null),
    withTimeout(fromBigData(lat, lon, lang), 2800).catch(() => null),
  ]);
  return precise || fast;
}

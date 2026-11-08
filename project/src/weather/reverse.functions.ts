import { createServerFn } from "@tanstack/react-start";

export type ReverseHit = { name: string; admin: string; country: string } | null;

export const reversePlace = createServerFn({ method: "GET" })
  .validator((input: unknown): { lat: number; lon: number } => {
    const raw = input as { lat?: unknown; lon?: unknown } | null;
    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("bad coords");
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("bad coords");
    return { lat, lon };
  })
  .handler(async ({ data }): Promise<ReverseHit> => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(data.lat));
    url.searchParams.set("lon", String(data.lon));
    url.searchParams.set("zoom", "10");
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MyWeatherPro/1.0 (weather app)",
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        name?: string;
        address?: Record<string, string | undefined>;
      };
      const address = json.address ?? {};
      const name =
        address.city || address.town || address.village || address.hamlet || address.state || json.name || "";
      if (!name) return null;
      return {
        name,
        admin: address.state || "",
        country: address.country || "",
      };
    } catch {
      return null;
    }
  });

import { createServerFn } from "@tanstack/react-start";

const ALLOWED = new Set([
  "api.open-meteo.com",
  "air-quality-api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "marine-api.open-meteo.com",
  "www.gdacs.org",
  "www.nhc.noaa.gov",
  "www.metoc.navy.mil",
  "tgftp.nws.noaa.gov",
  "api.met.no",
]);

/** الطلب يمرّ من الخادم حتى لا يطبع المتصفح 429 كخطأ، مع حصر المضيف. */
export const proxyWeather = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const url = new URL(String((input as { url?: string } | null)?.url ?? ""));
    if (!ALLOWED.has(url.hostname) || url.protocol !== "https:") throw new Error("host");
    return { url: url.toString() };
  })
  .handler(async ({ data }) => {
    try {
      const res = await fetch(data.url, { signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      return { status: res.status, body: body.slice(0, 4_000_000) };
    } catch {
      return { status: 0, body: "" };
    }
  });

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

/** Prevent turning the unauthenticated weather proxy into an SSRF tunnel. */
export function validateWeatherProxyUrl(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 8192) throw new Error("url");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("url"); }
  if (url.protocol !== "https:" || !ALLOWED.has(url.hostname.toLowerCase()) ||
      (url.port !== "" && url.port !== "443") || url.username || url.password) {
    throw new Error("host");
  }
  url.hash = "";
  return url.toString();
}

/** Limit the response before allocating strings or keeping the whole payload. */
export async function readBoundedWeatherResponse(res: Response, max = 4_000_000): Promise<string> {
  const size = Number(res.headers.get("content-length") || "0");
  if (Number.isFinite(size) && size > max) throw new Error("weather-response-too-large");
  const stream = res.body;
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel().catch(() => undefined);
        throw new Error("weather-response-too-large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

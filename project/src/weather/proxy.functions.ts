import { createServerFn } from "@tanstack/react-start";
import { validatedWeatherProxyUrl } from "./proxySecurity";

const MAX_BODY_BYTES = 4_000_000;
const MAX_CONCURRENT = 8;
let active = 0;

/** Proxy only known HTTPS weather hosts: bounded egress, no SSRF redirects,
 * capped concurrency and streamed response bodies protect shared resources.
 */
export const proxyWeather = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const data = input as { url?: unknown } | null;
    return { url: validatedWeatherProxyUrl(data?.url) };
  })
  .handler(async ({ data }) => {
    // Do not allow one client to exhaust all outbound connections to providers.
    if (active >= MAX_CONCURRENT) return { status: 429, body: "" };
    active += 1;
    try {
      const res = await fetch(data.url, {
        signal: AbortSignal.timeout(16000),
        redirect: "error", // never follow a provider redirect to private IPs
        cache: "no-store",
      });
      const stated = Number(res.headers.get("content-length") || 0);
      if (Number.isFinite(stated) && stated > MAX_BODY_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        return { status: 502, body: "" };
      }
      if (!res.body) return { status: res.status, body: "" };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let body = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            return { status: 502, body: "" };
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      return { status: res.status, body };
    } catch {
      return { status: 0, body: "" };
    } finally {
      active -= 1;
    }
  });

import { createServerFn } from "@tanstack/react-start";

import { readBoundedWeatherResponse, validateWeatherProxyUrl } from "@/weather/proxyPolicy";

// Per-server-isolate budget; edge/CDN rate limits remain required for DDoS
// protection in production, as no in-process counter can be globally absolute.
let activeProxyRequests = 0;
const MAX_PROXY_REQUESTS = 8;

/** الطلب يمرّ من الخادم حتى لا يطبع المتصفح 429 كخطأ، مع حصر المضيف. */
export const proxyWeather = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    return { url: validateWeatherProxyUrl((input as { url?: unknown } | null)?.url) };
  })
  .handler(async ({ data }) => {
    if (activeProxyRequests >= MAX_PROXY_REQUESTS) return { status: 503, body: "" };
    activeProxyRequests += 1;
    try {
      const res = await fetch(data.url, {
        method: "GET",
        redirect: "error", // No redirects to unapproved hosts or private networks.
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "application/json, text/plain, application/xml, */*" },
      });
      const body = await readBoundedWeatherResponse(res);
      return { status: res.status, body };
    } catch (err) {
      // Do not return error strings or internal URLs to anonymous callers.
      return { status: err instanceof Error && err.message === "weather-response-too-large" ? 413 : 0, body: "" };
    } finally {
      activeProxyRequests -= 1;
    }
  });

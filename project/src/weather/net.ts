import { CapacitorHttp } from "@capacitor/core";
import { proxyWeather } from "@/weather/proxy.functions";
import { RequestSlots, raceRequestTimeout } from "@/weather/requestSlots";

function nativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

function htmlPage(body: string): boolean {
  const t = body.trim();
  return t.startsWith("<!") || /^<html[\s>]/i.test(t);
}

/** ويب فيو أندرويد يعلّق الطلب إلى الأبد إن لم يُقطع، فيقف الجلب كله. */
// Native HTTP and browser fallback share one bounded, abort-aware budget.
const slots = new RequestSlots(5, 32);

const headers = {
  Accept: "application/json, text/plain, */*",
};

async function nativePluginFetch(
  url: string,
  signal: AbortSignal | undefined,
  ms: number,
  hdrs: Record<string, string>,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const release = await slots.acquire(signal);
  try {
    const result = await raceRequestTimeout(
      CapacitorHttp.request({
        url,
        method: "GET",
        responseType: "text",
        connectTimeout: ms,
        readTimeout: ms,
        headers: hdrs,
      }),
      ms + 800,
      signal,
    );
    const data = result.data;
    const body = typeof data === "string" ? data : JSON.stringify(data ?? "");
    return new Response(body, { status: result.status || 0 });
  } finally {
    release();
  }
}

async function timedFetch(
  url: string,
  signal: AbortSignal | undefined,
  ms: number,
  hdrs: Record<string, string>,
): Promise<Response> {
  const release = await slots.acquire(signal);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: hdrs });
  } catch (err) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (err instanceof DOMException && err.name === "AbortError") throw new Error("proxy-timeout");
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    release();
  }
}

/** استجابة اصطناعية من نتيجة الخادم — المتصفح لا يرى فشل Open-Meteo مباشرة. */
export async function proxyFetch(url: string, signal?: AbortSignal, extra?: Record<string, string>): Promise<Response> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const hdrs = extra ? { ...headers, ...extra } : headers;
  if (nativeApp()) {
    try {
      const res = await nativePluginFetch(url, signal, 18000, hdrs);
      const soft = res.status === 403 || res.status >= 500;
      if (!soft) return res;
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
    }
  } else {
    try {
      const result = await raceRequestTimeout(proxyWeather({ data: { url } }), 10000, signal);
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const body = result?.body ?? "";
      const status = result?.status ?? 0;
      const unusable = status === 429 || status >= 500 || status === 0 || !body.trim() || htmlPage(body);
      if (!unusable) return new Response(body, { status });
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
    }
  }
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  return timedFetch(url, signal, 12000, hdrs);
}

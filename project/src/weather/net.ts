import { CapacitorHttp } from "@capacitor/core";
import { proxyWeather } from "@/weather/proxy.functions";

function nativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

function raceTimeout<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value as T);
    };
    const onAbort = () => finish(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(() => finish(new Error("proxy-timeout")), ms);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    work.then(value => finish(null, value), error => finish(error));
  });
}

function htmlPage(body: string): boolean {
  const t = body.trim();
  return t.startsWith("<!") || /^<html[\s>]/i.test(t);
}

/** ويب فيو أندرويد يعلّق الطلب إلى الأبد إن لم يُقطع، فيقف الجلب كله. */
const MAX_IN_FLIGHT = 5;
const MAX_WAITERS = 64;
let inFlight = 0;
type Waiter = { grant: () => void };
const waiters: Waiter[] = [];

/** Cancelable backpressure: aborted map/city requests leave the queue
 * immediately instead of lingering and consuming network slots later.
 */
function takeSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  if (waiters.length >= MAX_WAITERS) return Promise.reject(new Error("proxy-queue-full"));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const waiter: Waiter = { grant: () => {
      cleanup();
      inFlight += 1;
      resolve();
    } };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const rejectWait = (error: Error) => {
      const index = waiters.indexOf(waiter);
      if (index < 0) return; // already granted
      waiters.splice(index, 1);
      cleanup();
      reject(error);
    };
    const onAbort = () => rejectWait(new DOMException("aborted", "AbortError"));
    timer = setTimeout(() => rejectWait(new Error("proxy-queue-timeout")), 16000);
    waiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  waiters.shift()?.grant();
}

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
  await takeSlot(signal);
  try {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const result = await raceTimeout(
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
    releaseSlot();
  }
}

async function timedFetch(
  url: string,
  signal: AbortSignal | undefined,
  ms: number,
  hdrs: Record<string, string>,
): Promise<Response> {
  await takeSlot(signal);
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
    releaseSlot();
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
      const result = await raceTimeout(proxyWeather({ data: { url } }), 10000, signal);
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

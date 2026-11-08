import { Capacitor, CapacitorHttp } from "@capacitor/core";

export class NetworkFailure extends Error {
  constructor(public status: number) {
    super(status === 429 ? "quota" : status ? `http ${status}` : "connection");
  }
}
// Reserve foreground capacity for current weather and location names.
export function requestLane(limit: number) {
  let running = 0;
  const queue: Array<{
    start: () => void;
    cancel: () => void;
    signal?: AbortSignal;
  }> = [];
  const pump = () => {
    while (running < limit && queue.length) {
      const job = queue.shift()!;
      job.signal?.removeEventListener("abort", job.cancel);
      if (job.signal?.aborted) {
        job.cancel();
        continue;
      }
      running++;
      job.start();
    }
  };
  return (signal?: AbortSignal): Promise<() => void> =>
    new Promise((resolve, reject) => {
      const cancel = () => {
        const i = queue.indexOf(ticket);
        if (i >= 0) queue.splice(i, 1);
        reject(new DOMException("aborted", "AbortError"));
      };
      const ticket = {
        signal,
        cancel,
        start: () => {
          let done = false;
          resolve(() => {
            if (!done) {
              done = true;
              running--;
              pump();
            }
          });
        },
      };
      if (signal?.aborted) {
        cancel();
        return;
      }
      queue.push(ticket);
      signal?.addEventListener("abort", cancel, { once: true });
      pump();
    });
}
const foreground = requestLane(2),
  background = requestLane(2);
const cooldown = new Map<string, number>();
// Keep only transport/status diagnostics; never store request URLs or coordinates.
export type ForecastConnectionDiagnostic = { source: "native" | "web" | "local"; status: number; at: number };
let lastForecastDiagnostic: ForecastConnectionDiagnostic | null = null;
export function getForecastConnectionDiagnostic(): ForecastConnectionDiagnostic | null { return lastForecastDiagnostic; }
function noteForecast(source: ForecastConnectionDiagnostic["source"], status: number): void {
  lastForecastDiagnostic = { source, status, at: Date.now() };
}
// Bound map-grid traffic independently so it cannot exhaust the shared forecast API.
const backgroundRequests: number[] = [];
const BACKGROUND_WINDOW_MS = 10 * 60_000;
const BACKGROUND_LIMIT = 3;
let foregroundPending = 0;
function reserveBackgroundRequest(): void {
  const now = Date.now();
  while (backgroundRequests.length && now - backgroundRequests[0]! >= BACKGROUND_WINDOW_MS) backgroundRequests.shift();
  if (backgroundRequests.length >= BACKGROUND_LIMIT) throw new NetworkFailure(503);
  backgroundRequests.push(now);
}
const headers = { Accept: "application/json, text/plain, */*" };
function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  ms: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      clean();
      reject(new NetworkFailure(0));
    }, ms);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    work.then(
      (v) => {
        clean();
        resolve(v);
      },
      (e) => {
        clean();
        reject(e);
      },
    );
  });
}
async function request(url: string, signal?: AbortSignal): Promise<Response> {
  if (Capacitor.isNativePlatform()) {
    try {
      const r = await abortable(
        CapacitorHttp.request({
          url,
          method: "GET",
          responseType: "text",
          connectTimeout: 10000,
          readTimeout: 15000,
          headers,
        }),
        signal,
        17000,
      );
      if (r.status < 200 || r.status > 599) throw new NetworkFailure(0);
      noteForecast("native", r.status);
      return new Response(
        typeof r.data === "string" ? r.data : JSON.stringify(r.data),
        { status: r.status, headers: r.headers },
      );
    } catch (e) {
      if (signal?.aborted) throw e;
      // Native transport failure: fall back to WebView fetch only for connection errors.
      // HTTP responses (including 429) must never be retried through a second transport.
      if (e instanceof NetworkFailure && e.status !== 0) throw e;
    }
  }
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, 12000);
  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers,
      cache: "no-store",
    });
    noteForecast("web", response.status);
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
export async function proxyFetch(
  url: string,
  signal?: AbortSignal,
  priority: "foreground" | "background" = "foreground",
): Promise<Response> {
  const host = new URL(url).host;
  // Map-grid rate limits must not suppress independent current-weather attempts.
  const cooldownKey = `${host}:${priority}`;
  if (priority === "foreground") foregroundPending++;
  let release: (() => void) | undefined;
  try {
    release = await (priority === "background" ? background : foreground)(signal);
  } catch (err) {
    if (priority === "foreground") foregroundPending--;
    throw err;
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (Date.now() < (cooldown.get(cooldownKey) ?? 0)) {
        if (priority === "foreground") noteForecast("local", 429);
        throw new NetworkFailure(429);
      }
      if (priority === "background") {
        reserveBackgroundRequest();
      }
      try {
        const response = await request(url, signal);
        if (response.status === 429) {
          const raw = response.headers.get("retry-after");
          const seconds = Number(raw);
          const ms =
            raw && Number.isFinite(seconds)
              ? seconds * 1000
              : raw
                ? Date.parse(raw) - Date.now()
                : 60000;
          cooldown.set(
            cooldownKey,
            Date.now() +
              Math.max(
                1000,
                Math.min(Number.isFinite(ms) ? ms : 60000, 1800000),
              ),
          );
          throw new NetworkFailure(429);
        }
        if (response.status >= 500 && attempt === 0) continue;
        return response;
      } catch (e) {
        if (
          signal?.aborted ||
          (e instanceof NetworkFailure && e.status === 429)
        )
          throw e;
        if (attempt === 1) throw e;
      }
    }
    throw new NetworkFailure(0);
  } finally {
    release?.();
    if (priority === "foreground") foregroundPending--;
  }
}

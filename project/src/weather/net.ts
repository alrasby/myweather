import { Capacitor, CapacitorHttp } from "@capacitor/core";

export class NetworkFailure extends Error {
  constructor(
    public status: number,
    public retryAfterMs?: number,
  ) {
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
  background = requestLane(3);
const cooldown = new Map<string, number>();
// Keep only transport/status diagnostics; never store request URLs or coordinates.
export type ForecastConnectionDiagnostic = { source: "native" | "web" | "local"; status: number; at: number; retryAfterMs?: number; providerReason?: string };
let lastForecastDiagnostic: ForecastConnectionDiagnostic | null = null;
export function getForecastConnectionDiagnostic(): ForecastConnectionDiagnostic | null { return lastForecastDiagnostic; }
function noteForecast(source: ForecastConnectionDiagnostic["source"], status: number, retryAfterMs?: number, providerReason?: string): void {
  lastForecastDiagnostic = { source, status, at: Date.now(), retryAfterMs, providerReason };
}
// Bound map-grid traffic independently so it cannot exhaust the shared forecast API.
// The provider counts LOCATIONS (not HTTP requests), so the budget is weighted by
// location count. Limits are kept well under the free tier (600/min, 5,000/h, 10,000/day)
// to leave room for the foreground forecast.
const BUDGET_KEY = "wx-open-meteo-budget-v1";
const BUDGET_WINDOWS = [
  { ms: 60_000, max: 480 },
  { ms: 3_600_000, max: 3_200 },
  { ms: 86_400_000, max: 7_500 },
] as const;
type Spend = [number, number]; // [timestamp ms, weight]
let spends: Spend[] | null = null;
let foregroundPending = 0;

function loadSpends(): Spend[] {
  if (spends) return spends;
  spends = [];
  try {
    if (typeof localStorage !== "undefined") {
      const raw = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? "[]") as unknown;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (Array.isArray(item) && Number.isFinite(item[0]) && Number.isFinite(item[1])) spends.push([item[0], item[1]]);
        }
      }
    }
  } catch {
    /* التخزين غير متاح: الميزانية تبقى في الذاكرة فقط */
  }
  return spends;
}
function saveSpends(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(BUDGET_KEY, JSON.stringify(loadSpends()));
  } catch {
    /* التخزين ممتلئ */
  }
}
function pruneSpends(now: number): Spend[] {
  const list = loadSpends();
  const oldest = now - BUDGET_WINDOWS[BUDGET_WINDOWS.length - 1]!.ms;
  while (list.length && list[0]![0] < oldest) list.shift();
  return list;
}
/** وزن الطلب = عدد المواقع × ceil(المتغيرات / 10). غير Open-Meteo = 0. */
export function requestWeight(url: string): number {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 0;
  }
  if (u.hostname !== "api.open-meteo.com") return 0;
  const locations = Math.max(1, (u.searchParams.get("latitude") ?? "").split(",").filter(Boolean).length);
  let vars = 0;
  for (const key of ["hourly", "daily", "current"]) vars += (u.searchParams.get(key) ?? "").split(",").filter(Boolean).length;
  return locations * Math.max(1, Math.ceil(vars / 10));
}
/** الانتظار (ms) حتى يتّسع الوزن في كل النوافذ. 0 = متاح الآن. */
function budgetWait(weight: number, now: number): number {
  const list = pruneSpends(now);
  let wait = 0;
  for (const win of BUDGET_WINDOWS) {
    let used = 0;
    for (const [ts, w] of list) if (now - ts < win.ms) used += w;
    let over = used + weight - win.max;
    if (over <= 0) continue;
    for (const [ts, w] of list) {
      if (now - ts >= win.ms) continue;
      over -= w;
      if (over <= 0) {
        wait = Math.max(wait, ts + win.ms - now + 50);
        break;
      }
    }
    if (over > 0) wait = Math.max(wait, win.ms);
  }
  return wait;
}
function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
/**
 * يحجز ميزانية الخريطة. الانتظار القصير (≤ 20 ث) يحدث بصمت؛ الأطول يُرفض بـ429 مع
 * مدة واضحة حتى تُعيد الواجهة المحاولة تلقائيًا بدل خطأ عام.
 */
async function reserveBackground(weight: number, signal?: AbortSignal): Promise<void> {
  if (!weight) return;
  for (let round = 0; round < 4; round++) {
    const wait = budgetWait(weight, Date.now());
    if (wait <= 0) {
      loadSpends().push([Date.now(), weight]);
      saveSpends();
      return;
    }
    if (wait > 20_000) throw new NetworkFailure(429, wait);
    await sleepMs(wait, signal);
  }
  throw new NetworkFailure(429, 20_000);
}
function recordForeground(weight: number): void {
  if (!weight) return;
  loadSpends().push([Date.now(), weight]);
  saveSpends();
}
/** المدة المتبقية (ms) قبل أن تُسمح طلبات الخريطة من جديد. 0 = لا حظر. */
export function backgroundCooldownMs(): number {
  const until = cooldown.get("api.open-meteo.com:background:other") ?? 0;
  return Math.max(0, until - Date.now());
}
/** مدة الانتظار بحسب نص رفض المزوّد (يومي/ساعي/دقيقي)، أو null إن لم يُعرف. */
function providerLimitWaitMs(body: string): number | null {
  const now = new Date();
  if (/daily (?:api )?request limit|daily limit exceeded/i.test(body)) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 5_000;
  }
  if (/hourly (?:api )?request limit|hourly limit exceeded/i.test(body)) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1) - now.getTime() + 5_000;
  }
  if (/minutely (?:api )?request limit|minutely limit exceeded|per.minute/i.test(body)) return 65_000;
  return null;
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
async function request(url: string, signal?: AbortSignal, forecast = false): Promise<Response> {
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
      if (forecast) noteForecast("native", r.status);
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
    if (forecast) noteForecast("web", response.status);
    return response;
  } catch (err) {
    if (forecast && !signal?.aborted) noteForecast("web", 0);
    throw err;
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
  const isForecast = priority === "foreground" && host === "api.open-meteo.com" && new URL(url).pathname === "/v1/forecast";
  // Geocoding and other foreground calls must not inherit forecast backoff.
  const cooldownKey = `${host}:${priority}:${isForecast ? "forecast" : "other"}`;
  if (priority === "foreground") foregroundPending++;
  const weight = requestWeight(url);
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
        if (isForecast) noteForecast("local", 429, (cooldown.get(cooldownKey) ?? 0) - Date.now(), lastForecastDiagnostic?.providerReason);
        throw new NetworkFailure(429);
      }
      if (attempt === 0) {
        if (priority === "background") {
          try {
            await reserveBackground(weight, signal);
          } catch (e) {
            if (e instanceof NetworkFailure && e.status === 429) {
              cooldown.set(cooldownKey, Date.now() + (e.retryAfterMs ?? 60_000));
            }
            throw e;
          }
        } else {
          recordForeground(weight);
        }
      }
      try {
        const response = await request(url, signal, isForecast);
        if (response.status === 429) {
          const raw = response.headers.get("retry-after")?.trim();
          const seconds = raw && /^[0-9]+(?:\.[0-9]+)?$/.test(raw) ? Number(raw) : NaN;
          const retryMs = Number.isFinite(seconds)
            ? seconds * 1000
            : raw ? Date.parse(raw) - Date.now() : NaN;
          // A missing/invalid Retry-After gets a short backoff, not an arbitrary long lock.
          // A real provider Retry-After is respected (up to 30 minutes).
          let delay = Math.max(5000, Math.min(Number.isFinite(retryMs) ? retryMs : 60000, 1800000));
          // Inspect only a bounded provider error body; never record URL or coordinates.
          let reason = "unknown";
          try {
            const body = (await response.clone().text()).slice(0, 2048);
            const longer = providerLimitWaitMs(body);
            if (/daily (?:api )?request limit|daily limit exceeded/i.test(body)) reason = "daily-limit";
            else if (/hourly (?:api )?request limit|hourly limit exceeded/i.test(body)) reason = "hourly-limit";
            else if (/minute|per.minute/i.test(body)) reason = "minute-limit";
            else if (/rate.limit|too many requests/i.test(body)) reason = "rate-limit";
            // حدّ يومي/ساعي حقيقي: لا فائدة من الإعادة قبل انتهائه (بحد أقصى 6 ساعات).
            if (longer != null) delay = Math.max(delay, Math.min(longer, 6 * 3_600_000));
          } catch { /* diagnostic only */ }
          cooldown.set(cooldownKey, Date.now() + delay);
          if (isForecast) {
            noteForecast(lastForecastDiagnostic?.source === "native" ? "native" : "web", 429, delay, reason);
          }
          throw new NetworkFailure(429, delay);
        }
        if (response.status >= 500 && attempt === 0) continue;
        return response;
      } catch (e) {
        if (isForecast && !signal?.aborted && !(e instanceof NetworkFailure && e.status === 429)) {
          noteForecast(lastForecastDiagnostic?.source === "native" ? "native" : "web", e instanceof NetworkFailure ? e.status : 0);
        }
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

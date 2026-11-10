import type { Map as LeafletMap } from "leaflet";
import { spatialFrameReadyDuringRefresh, modelVariablesReady, SPATIAL_LAYER_COUNT } from "@/weather/modelTileReadiness";
import { selectSpatialFramePlan, spatialStackKey } from "@/weather/modelFrameTimeline";
import { planSpatialRequests, canAdvanceSpatialTime } from "@/weather/modelFrameQueue";
import { SpatialNativeQueue } from "@/weather/spatialNativeQueue";
import { SpatialRangeCache } from "@/weather/spatialRangeCache";
import { spatialTileOptions } from "@/weather/spatialTilePolicy";
import { spatialFrameTimedOut } from "@/weather/spatialWatchdog";
import { spatialFreshness, type SpatialMetadata } from "@/weather/spatialFreshness";
import { SpatialPerformance, type SpatialPerfSnapshot } from "@/weather/spatialPerformance";
import { spatialOmFileUrl, spatialForecastIntervalHours, type SpatialRun } from "@/weather/spatialRunPaths";
import { spatialLayerTiming, type SpatialLayerTiming } from "@/weather/spatialLayerTelemetry";
import { CapacitorHttp } from "@capacitor/core";
import {
  addLeafletProtocolSupport,
  defaultOmProtocolSettings,
  omProtocol,
} from "@openmeteo/weather-map-layer";

/**
 * غيوم ومطر وثلج من شبكة ECMWF نفسها (نحو ٩ كم).
 * على أندرويد يعيد Capacitor كتابة fetch ويكسر طلبات Range للملفات الثنائية،
 * فتبقى اللوحة فارغة. الطلبات المكانية تمرّ على fetch الأصلي للمتصفح.
 */

const META = "https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json";

export type WeatherDiagnosticMode = "all" | "cloud" | "rain" | "snow" | "fallback";
export type WeatherModelDiagnostics = {
  mode: WeatherDiagnosticMode;
  source: "spatial" | "fallback";
  frame: number;
  requestedFrame: number;
  displayedFrame: number | null;
  requestedValidTime: string | null;
  displayedValidTime: string | null;
  holdingPreviousFrame: boolean;
  loaded: boolean[];
  tileCounts: number[];
  errors: number[];
  visibleOpacity: number;
  metadataAvailable: boolean;
  error: string | null;
  cacheHits: number;
  nativeReads: number;
  layerTimings: SpatialLayerTiming[];
  loadingFrames: number[];
  cacheEligible: number;
  cacheStored: number;
  cacheRejected: number;
  timings: SpatialPerfSnapshot;
  workerSharedMemory: boolean;
  modelRunReference: string | null;
  runPath: "direct-om" | "capture-api";
};

type AnyLayer = {
  addTo: (map: LeafletMap) => AnyLayer;
  remove: () => void;
  on: (event: string, fn: (ev?: { tile?: HTMLElement }) => void) => void;
  setOpacity?: (opacity: number) => void;
  bringToFront?: () => void;
};

type Adapter = {
  addProtocol: (name: string, handler: typeof omProtocol, settings?: ReturnType<typeof modelSettings>) => void;
  createTileLayer: (url: string, options?: Record<string, unknown>) => AnyLayer;
};

const RAIN = {
  type: "breakpoint" as const,
  unit: "mm/h",
  breakpoints: [0.12, 0.4, 0.9, 1.8, 3.5, 7, 12, 20],
  colors: [
    [176, 214, 248, 0],
    [72, 158, 236, 0.56],
    [22, 104, 214, 0.72],
    [14, 158, 86, 0.84],
    [190, 206, 22, 0.91],
    [255, 176, 0, 0.94],
    [224, 58, 26, 0.96],
    [132, 34, 176, 0.97],
  ],
};

const SNOW = {
  type: "breakpoint" as const,
  unit: "mm/h",
  breakpoints: [0.08, 0.25, 0.7, 1.6],
  colors: [
    [213, 229, 249, 0],
    [154, 204, 251, 0.64],
    [226, 243, 255, 0.84],
    [249, 253, 255, 0.95],
  ],
};

const CLOUD = {
  type: "breakpoint" as const,
  unit: "%",
  // Show well-defined dense cloud masses; thin widespread cover should not
  // wash the satellite imagery out into a nearly uniform grey fog.
  breakpoints: [55, 70, 82, 90, 96, 100],
  colors: [
    [255, 255, 255, 0],
    [255, 255, 255, 0],
    [249, 252, 255, 0.07],
    [248, 251, 255, 0.24],
    [244, 249, 255, 0.43],
    [244, 249, 255, 0.57],
  ],
};

function modelSettings() {
  const colorScales = {
    ...defaultOmProtocolSettings.colorScales,
    precipitation: RAIN,
    rain: RAIN,
    snowfall_water_equivalent: SNOW,
    snowfall: SNOW,
    cloud_cover: CLOUD,
    cloud_cover_low: CLOUD,
    cloud_cover_mid: CLOUD,
    cloud_cover_high: CLOUD,
  };
  return { ...defaultOmProtocolSettings, colorScales };
}

function spatialUrl(url: string): boolean {
  return /openmeteo\.s3[.-]|data_spatial|\.om(?:\?|$)/i.test(url);
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}

function headerBag(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function rangeLength(headers: Headers): number | null {
  const raw = headers.get("Range") ?? headers.get("range");
  const match = raw?.match(/bytes=(\d+)-(\d+)/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start + 1;
}

function decode64(raw: string): Uint8Array {
  const clean = raw.replace(/\s/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function headerName(key: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key);
}

function bytesOf(data: unknown, method: string): Uint8Array {
  if (method === "HEAD" || data == null) return new Uint8Array();
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data) && data.every((n) => typeof n === "number")) return Uint8Array.from(data as number[]);
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return new TextEncoder().encode(data);
    try {
      return decode64(data);
    } catch {
      return new TextEncoder().encode(data);
    }
  }
  return new TextEncoder().encode(JSON.stringify(data));
}

function nativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

function responseFrom(status: number, headers: Headers, bytes: Uint8Array): Response {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(bytes.byteLength ? body : null, { status: status || 0, headers });
}

// Six bounded native reads improve spatial decoding throughput on mobile
// without allowing the dozens of simultaneous Range fetches triggered by
// three Leaflet model layers. Every request still obeys cancellation.
const spatialNativeQueue = new SpatialNativeQueue(6);
const spatialRangeCache = new SpatialRangeCache();
const spatialPerformance = new SpatialPerformance();
let spatialCacheHits = 0;
let spatialNativeReads = 0;
let spatialCacheEligible = 0;
let spatialCacheStored = 0;
let spatialCacheRejected = 0;
const spatialFileLengths = new Map<string, { value: string; expires: number }>();

async function pluginSpatial(url: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
  const bag: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (headerName(key)) bag[key] = value;
  });
  bag["Accept-Encoding"] = "identity";
  const method = (init?.method ?? "GET").toUpperCase();
  const range = method === "GET" ? headers.get("range") : null;
  const cacheKey = range && /^bytes=\d+-\d+$/i.test(range) ? `${url}|${range}` : null;
  if (init?.signal?.aborted) throw new Error("spatial-request-aborted");
  const cached = cacheKey ? spatialRangeCache.get(cacheKey) : null;
  if (cached) {
    spatialCacheHits++;
    return responseFrom(cached.status, new Headers(cached.headers), cached.bytes);
  }
  if (cacheKey) spatialCacheEligible++;
  const queuedAt = performance.now();
  const result = await spatialNativeQueue.run(init?.signal ?? undefined, async () => {
    spatialPerformance.observe("nativeQueue", performance.now() - queuedAt);
    spatialNativeReads++;
    const nativeStarted = performance.now();
    try {
      return await CapacitorHttp.request({
    url,
    method,
    headers: bag,
    responseType: method === "HEAD" ? "text" : "arraybuffer",
    connectTimeout: 20000,
    readTimeout: 25000,
      });
    } finally {
      spatialPerformance.observe("network", performance.now() - nativeStarted);
    }
  });
  const out = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (value != null && headerName(key)) out.set(key, String(value));
  }
  const bytes = bytesOf(result.data, method);
  if (method === "HEAD" && !out.get("content-length")) {
    const total = await probeLength(url, headers, init?.signal ?? undefined);
    if (total) out.set("content-length", total);
  }
  const expect = rangeLength(headers);
  if (expect != null && bytes.byteLength !== expect) {
    throw new Error(`range ${bytes.byteLength}!=${expect}`);
  }
  if ((result.status || 0) >= 400 || result.status === 0) throw new Error(`spatial ${result.status}`);
  if (cacheKey && result.status === 206 && bytes.byteLength > 0) {
    const savedHeaders: Record<string, string> = {};
    out.forEach((value, key) => { savedHeaders[key] = value; });
    if (bytes.byteLength <= 256 * 1024) {
      spatialRangeCache.put(cacheKey, { bytes, status: 206, headers: savedHeaders });
      spatialCacheStored++;
    } else {
      spatialCacheRejected++;
    }
  } else if (cacheKey) {
    // Distinguish unique range requests from non-206/empty responses;
    // a low cache-hit count is not proof of a cache implementation bug.
    spatialCacheRejected++;
  }
  return responseFrom(result.status || 200, out, bytes);
}

async function probeLength(url: string, headers: Headers, signal?: AbortSignal): Promise<string | null> {
  const cached = spatialFileLengths.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  const bag: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (headerName(key) && key.toLowerCase() !== "range") bag[key] = value;
  });
  bag.Range = "bytes=0-0";
  bag["Accept-Encoding"] = "identity";
  const queuedAt = performance.now();
  const result = await spatialNativeQueue.run(signal, async () => {
    spatialPerformance.observe("nativeQueue", performance.now() - queuedAt);
    spatialNativeReads++;
    const nativeStarted = performance.now();
    try {
      return await CapacitorHttp.request({
      url,
      method: "GET",
      headers: bag,
      responseType: "text",
      connectTimeout: 15000,
      readTimeout: 15000,
      });
    } finally {
      spatialPerformance.observe("network", performance.now() - nativeStarted);
    }
  });
  const map = result.headers ?? {};
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() !== "content-range" || value == null) continue;
    const total = String(value).match(/\/(\d+)\s*$/)?.[1];
    if (total) {
      spatialFileLengths.set(url, { value: total, expires: Date.now() + 90_000 });
      return total;
    }
  }
  return null;
}

/** يُستدعى بعد جسر كاباستور. بلا أثر في المتصفح العادي. */
export function installSpatialFetch(): void {
  const w = window as Window & { CapacitorWebFetch?: typeof fetch; __wxSpatial?: boolean };
  if (w.__wxSpatial) return;
  const native = nativeApp();
  if (!native && typeof w.CapacitorWebFetch !== "function") return;
  w.__wxSpatial = true;
  const proxied = w.fetch.bind(w);
  const direct = (typeof w.CapacitorWebFetch === "function" ? w.CapacitorWebFetch : w.fetch).bind(w);
  w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!spatialUrl(url)) return proxied(input, init);
    const headers = headerBag(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (native) {
      try {
        return await pluginSpatial(url, { ...init, method, signal }, headers);
      } catch {
        // A cancelled Leaflet frame must never start another network request.
        if (signal?.aborted) throw new Error("spatial-request-aborted");
        /* الطلب الأصلي للمتصفح إن رفضت الإضافة الطول */
      }
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    const retryStarted = performance.now();
    try {
      const res = await direct(input, { ...init, signal: ctrl.signal });
      const expect = rangeLength(headers);
      if (expect == null) return res;
      const buf = await res.arrayBuffer();
      if (buf.byteLength === expect && res.status < 400) {
        return new Response(buf, { status: res.status, headers: res.headers });
      }
    } catch {
      /* بلا بديل سليم: تُحسب البلاطة فاشلة ويظهر الاحتياط */
    } finally {
      spatialPerformance.observe("browserRetry", performance.now() - retryStarted);
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    throw new Error("spatial-fetch");
  };
}
// End-to-end OM protocol timing includes S3 range reads, variable transfer,
 // worker decode and tile generation. It is NOT pure CPU decode time.
const measuredOmProtocol: typeof omProtocol = (...args) => {
  const started = performance.now();
  return Promise.resolve(omProtocol(...args)).then(
    (result) => {
      spatialPerformance.observe("workerTile", performance.now() - started);
      return result;
    },
    (error) => {
      spatialPerformance.observe("workerTile", performance.now() - started);
      throw error;
    },
  ) as ReturnType<typeof omProtocol>;
};

function tileUrl(variable: string, index: number, run: SpatialRun | null): string {
  // Avoid resolving latest.json for every tile request: the run metadata was
  // already fetched once and validated. Fall back to Capture API when a model
  // run lacks a trustworthy reference_time or direct OM data is unavailable.
  const base = run
    ? spatialOmFileUrl(META.replace(/\/latest\.json$/, ""), run, index)
    : null;
  const query = new URLSearchParams({
    variable,
    interpolation: "linear",
    color_blend: "true",
  });
  if (base && run) {
    query.set("delta_time_hours", String(spatialForecastIntervalHours(run.validTimes, index)));
  } else {
    query.set("time_step", `valid_times_${index}`);
  }
  return `om://${base ?? META}?${query.toString()}`;
}

export class ModelField {
  onLive: (() => void) | null = null;
  onMiss: (() => void) | null = null;

  private map: LeafletMap | null = null;
  private adapter: Adapter | null = null;
  private times: number[] = [];
  private modelRunReference: string | null = null;
  private directRun: SpatialRun | null = null;
  private lastError: string | null = null;
  private base = 0;
  private blend = 0;
  private failedUntil = new Map<number, number>();
  private loading = new Set<number>();
  private pendingTimers = new Map<number, number>();
  private frames = new Map<number, { layers: AnyLayer[]; token: number; opacity: number; ready: boolean; loaded: boolean[]; errored: Set<number>; tileCounts: number[]; errorCounts: number[]; layerStartedAt: number[]; layerFirstTileAt: number[]; layerLastTileAt: number[]; layerFinishedAt: number[] }>();
  private diagnosticMode: WeatherDiagnosticMode = "all";
  private spatialVisible = false;
  private lastDisplayedStep: number | null = null;
  private holdingPreviousFrame = false;
  private seq = 0;
  private orderKey = "";
  private visible = false;
  private lastSyncAt = 0;
  // Continuous pan refreshes must not reset the prefetch grace window every
  // time Leaflet emits another 'loading' for the same requested hour.
  private refreshBase: number | null = null;
  private refreshSince = 0;
  private ready: Promise<void> = Promise.resolve();

  attach(L: unknown, map: LeafletMap) {
    installSpatialFetch();
    this.map = map;
    if (!map.getPane("wx-clouds")) {
      const clouds = map.createPane("wx-clouds");
      clouds.style.zIndex = "245";
      clouds.style.pointerEvents = "none";
    }
    if (!map.getPane("wx-model")) {
      const pane = map.createPane("wx-model");
      pane.style.zIndex = "260";
      pane.style.pointerEvents = "none";
    }
    this.adapter = addLeafletProtocolSupport(L as never) as unknown as Adapter;
    this.adapter.addProtocol("om", measuredOmProtocol, modelSettings());
    this.lastError = null;
    this.ready = fetch(META, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: SpatialMetadata) => {
        const freshness = spatialFreshness(json, Date.now());
        this.modelRunReference = json.reference_time ?? null;
        if (!freshness.valid) {
          this.lastError = freshness.reason;
          this.times = [];
          return;
        }
        // Do not launch a partly available spatial frame: it would suppress
        // the global snowfall field even if the ECMWF snow file is absent.
        if (!modelVariablesReady(json.variables)) {
          this.lastError = "ECMWF model missing one or more cloud/rain/snow variables";
          console.warn("MyWeather: ECMWF spatial layer unavailable; retaining global rain/snow fallback");
          this.times = [];
          return;
        }
        this.times = freshness.times;
        const referenceTime = Date.parse(json.reference_time ?? "");
        this.directRun = Number.isFinite(referenceTime)
          ? { referenceTime, validTimes: freshness.times }
          : null;
      })
      .catch((error: unknown) => {
        this.lastError = String(error instanceof Error ? error.message : error).slice(0, 160);
        console.warn("MyWeather: spatial metadata fetch failed", this.lastError);
        this.times = [];
      });
  }

  whenReady(): Promise<number> {
    return this.ready.then(() => this.times.length);
  }

  /** Playback safety gate for the rain/snow map only. Frame decoding is
   * bounded; hold playback at a temporal boundary until ECMWF can show it.
   * Never freeze playback permanently when the upstream request is in cooldown. */
  canAdvanceTo(ms: number): boolean {
    if (!this.visible || !this.times.length) return true;
    const { i } = this.bracket(ms);
    const ready = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) ready.add(step);
    const blocked = new Set<number>();
    for (const [step, until] of this.failedUntil) if (until > Date.now()) blocked.add(step);
    return canAdvanceSpatialTime(i, ready, blocked, this.loading);
  }

  /** A deliberately hidden, read-only map diagnostic for comparing independent
   * weather fields without changing wind/temperature or map preferences. */
  setDiagnosticMode(mode: WeatherDiagnosticMode) {
    if (this.diagnosticMode === mode) return;
    this.diagnosticMode = mode;
    // Reapply each tile's visibility even if the frame opacity itself did
    // not change, so diagnostic isolation takes effect immediately.
    for (const frame of this.frames.values()) {
      if (!frame.ready) continue;
      frame.layers.forEach((layer, idx) => {
        const allowed = mode === "all" || (mode === "cloud" && idx === 0) ||
          (mode === "rain" && idx === 1) || (mode === "snow" && idx === 2);
        layer.setOpacity?.(allowed ? Math.max(0, frame.opacity) : 0);
      });
    }
    this.applyOpacity();
  }

  diagnostics(): WeatherModelDiagnostics {
    // Report the frame actually dominating the display, not merely the hour
    // being requested. The requested frame may still be pending/loading.
    const displayed = [...this.frames.entries()]
      .filter(([, frame]) => frame.ready && frame.opacity > 0.01)
      .sort((a, b) => b[1].opacity - a[1].opacity)[0]?.[0] ?? null;
    const frame = this.frames.get(this.base) ?? this.frames.get(this.base + 1);
    return {
      mode: this.diagnosticMode,
      source: this.spatialVisible ? "spatial" : "fallback",
      frame: this.base,
      requestedFrame: this.base,
      displayedFrame: this.spatialVisible ? displayed : null,
      requestedValidTime: this.times[this.base] != null ? new Date(this.times[this.base]).toISOString() : null,
      displayedValidTime: this.spatialVisible && displayed !== null && this.times[displayed] != null
        ? new Date(this.times[displayed]).toISOString() : null,
      holdingPreviousFrame: this.holdingPreviousFrame,
      loaded: frame?.loaded.slice() ?? [false, false, false],
      tileCounts: frame?.tileCounts.slice() ?? [0, 0, 0],
      errors: frame?.errorCounts.slice() ?? [0, 0, 0],
      visibleOpacity: frame?.opacity ?? 0,
      metadataAvailable: this.times.length > 0,
      error: this.lastError,
      cacheHits: spatialCacheHits,
      nativeReads: spatialNativeReads,
      cacheEligible: spatialCacheEligible,
      cacheStored: spatialCacheStored,
      cacheRejected: spatialCacheRejected,
      timings: spatialPerformance.snapshot(),
      workerSharedMemory: typeof crossOriginIsolated === "boolean" && crossOriginIsolated,
      modelRunReference: this.modelRunReference,
      runPath: this.directRun ? "direct-om" : "capture-api",
      layerTimings: Array.from({ length: SPATIAL_LAYER_COUNT }, (_, index) =>
        spatialLayerTiming(Date.now(), frame?.layerStartedAt[index] ?? 0,
          frame?.layerFirstTileAt[index] ?? 0, frame?.layerLastTileAt[index] ?? 0,
          frame?.layerFinishedAt[index] ?? 0)),
      loadingFrames: [...this.loading].sort((a, b) => a - b),
    };
  }

  setVisible(on: boolean) {
    this.visible = on;
    if (!on) {
      this.seq += 1;
      this.failedUntil.clear();
      this.loading.clear();
      this.orderKey = "";
      this.spatialVisible = false;
      this.lastDisplayedStep = null;
      this.holdingPreviousFrame = false;
      this.refreshBase = null;
      this.refreshSince = 0;
      this.clear();
    }
  }

  sync(ms: number) {
    if (!this.visible) return;
    // Forecast tile management does not need to run at the 60fps WebGL cadence.
    const now = performance.now();
    if (now - this.lastSyncAt < 50) return;
    this.lastSyncAt = now;
    installSpatialFetch();
    void this.ready.then(() => {
      if (!this.visible || !this.adapter || !this.map || !this.times.length) return;
      const { i, f } = this.bracket(ms);
      this.base = i;
      this.blend = f;
      this.pump();
      this.applyOpacity();
    });
  }

  /** الساعتان المحيطان بالزمن، ليمزج بينهما بدل القفزة. */
  private bracket(ms: number): { i: number; f: number } {
    const times = this.times;
    const n = times.length;
    if (n <= 1 || ms <= (times[0] ?? 0)) return { i: 0, f: 0 };
    const last = n - 1;
    if (ms >= (times[last] ?? 0)) return { i: last, f: 0 };
    let i = 0;
    while (i < last - 1 && ms >= (times[i + 1] ?? 0)) i += 1;
    const a = times[i] ?? ms;
    const b = times[i + 1] ?? a + 1;
    const t = Math.min(1, Math.max(0, (ms - a) / Math.max(1, b - a)));
    return { i, f: t * t * (3 - 2 * t) };
  }

  private pump() {
    if (!this.visible || !this.adapter || !this.map) return;
    const ready = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) ready.add(step);
    const blocked = new Set<number>();
    for (const [step, until] of this.failedUntil) if (until > Date.now()) blocked.add(step);
    // Favor the visible tile queues briefly, but DO NOT restart this clock
    // on each Leaflet pan/loading event. This guarantees that the next forecast
    // can begin within the configured grace period during continuous panning.
    const current = this.frames.get(this.base);
    const viewportRefreshing = !!current?.ready && current.loaded.some((complete) => !complete);
    const now = Date.now();
    if (!viewportRefreshing) {
      this.refreshBase = null;
      this.refreshSince = 0;
    } else if (this.refreshBase !== this.base || !this.refreshSince) {
      this.refreshBase = this.base;
      this.refreshSince = now;
    }
    const refreshAge = viewportRefreshing ? now - this.refreshSince : 0;
    const plan = planSpatialRequests(
      this.base, this.times.length, ready, this.loading, blocked, viewportRefreshing, refreshAge,
    );

    // Cancel obsolete decoding before scheduling the most relevant forecast.
    // A stale request must not occupy the bandwidth while the slider moves.
    for (const step of plan.cancel) this.discardFrame(step);
    this.dropFar(this.base);
    if (plan.start !== null && !this.frames.has(plan.start) && !this.loading.has(plan.start)) {
      this.failedUntil.delete(plan.start);
      this.mount(plan.start);
    }
  }

  private discardFrame(step: number) {
    const timer = this.pendingTimers.get(step);
    if (timer !== undefined) window.clearTimeout(timer);
    this.pendingTimers.delete(step);
    const frame = this.frames.get(step);
    this.frames.delete(step);
    this.loading.delete(step);
    // Removed Leaflet layers abort outstanding tile tasks. Their asynchronous
    // callbacks are ignored because their frame is no longer in the map.
    frame?.layers.forEach((layer) => layer.remove());
  }

  private dropFar(i: number) {
    const keep = new Set([i, i + 1]);
    if (this.lastDisplayedStep != null) keep.add(this.lastDisplayedStep);
    for (const [step, frame] of this.frames) {
      if (keep.has(step) || this.loading.has(step)) continue;
      if (frame.ready && frame.opacity > 0.04) continue;
      this.discardFrame(step);
    }
  }

  private newestReady(): number {
    let best = -1;
    for (const [step, frame] of this.frames) if (frame.ready && step > best) best = step;
    return best;
  }

  private anyReady(): boolean {
    for (const frame of this.frames.values()) if (frame.ready) return true;
    return false;
  }

  private mount(step: number) {
    const adapter = this.adapter;
    const map = this.map;
    if (!adapter || !map) return;
    const token = ++this.seq;
    this.loading.add(step);
    // Model tiles are expensive to decode: keep the current frame stable while
    // dragging/pinching, then fetch the new viewport once interaction settles.
    // Use coherent ECMWF model fields for actual cloud shape, precipitation
    // and snowfall instead of inflating low-resolution point forecasts.
    // Keep already-loaded tiles during gestures; load new coverage after idle.
    const cloudOpts = spatialTileOptions("wx-clouds");
    const rainOpts = spatialTileOptions("wx-model");
    const made = [
      adapter.createTileLayer(tileUrl("cloud_cover", step, this.directRun), cloudOpts),
      adapter.createTileLayer(tileUrl("precipitation", step, this.directRun), rainOpts),
      adapter.createTileLayer(tileUrl("snowfall_water_equivalent", step, this.directRun), rainOpts),
    ] as AnyLayer[];
    const frame = {
      layers: made, token, opacity: -1, ready: false,
      loaded: Array<boolean>(SPATIAL_LAYER_COUNT).fill(false),
      errored: new Set<number>(),
      tileCounts: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      errorCounts: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerStartedAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerFirstTileAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerLastTileAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerFinishedAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
    };
    this.frames.set(step, frame);
    if (!this.anyReady()) this.onMiss?.();
    let errors = 0;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    const alive = () => this.frames.get(step)?.token === token;
    const refresh = () => {
      if (!alive()) return;
      // A 'load' event without any tile delivery cannot prove that the
      // corresponding weather field is present in the current viewport.
      // Preserve the last fully rendered spatial frame while Leaflet refreshes
      // the visible viewport; do not expose the low-resolution global fallback
      // every time a cloud/rain/snow tile queue enters "loading".
      const ready = spatialFrameReadyDuringRefresh(frame.ready, frame.loaded, frame.errored, frame.tileCounts);
      // A completed successful reload clears stale timeout errors, even when
      // the previous frame already remained visible during the refresh.
      if (frame.loaded.every(Boolean) && frame.errored.size === 0 && frame.tileCounts.every((n) => n > 0)) {
        this.lastError = null;
      }
      if (ready === frame.ready) {
        // On a successful viewport refresh the existing frame stays visible;
        // resume prefetch once all queues finish, without hiding its imagery.
        if (ready && frame.loaded.every(Boolean)) this.pump();
        return;
      }
      frame.ready = ready;
      this.orderKey = "";
      if (ready) {
        this.loading.delete(step);
        this.failedUntil.delete(step);
        this.lastError = null;
        const timer = this.pendingTimers.get(step);
        if (timer !== undefined) window.clearTimeout(timer);
        this.pendingTimers.delete(step);
        // Start preloading the adjacent forecast as soon as the requested
        // frame finishes, rather than waiting for another gesture.
        this.pump();
      }
      if (!ready) {
        // Partial frames are never exposed: keep the global rain/snow canvas visible.
        frame.opacity = 0;
        for (const layer of made) layer.setOpacity?.(0);
      }
      this.applyOpacity();
    };
    const giveUp = () => {
      if (!alive() || frame.ready) return;
      // If a direct run-specific file is missing, retry using the published
      // Capture API. Do this once per attached model, never a retry loop.
      // A complete reference run can be valid while the first accumulated
      // precipitation/snowfall field has not been published.
      if (frame.errored.size && this.directRun) {
        this.directRun = null;
        this.lastError = "Direct ECMWF file unavailable; using compatible capture endpoint";
        this.discardFrame(step);
        this.pump();
        return;
      }
      // Failed frames are retryable: avoid a permanent weather outage after
      // one transient fetch error or a quick network switch.
      this.failedUntil.set(step, Date.now() + 15_000);
      this.lastError = frame.errored.size ? "ECMWF tile request failed" : "ECMWF tile readiness timeout";
      if (frame.errored.size) {
        console.warn("MyWeather: incomplete ECMWF spatial frame; retrying", { frame: step, errors: frame.errored.size });
      }
      this.discardFrame(step);
      if (!this.anyReady()) this.onMiss?.();
      this.pump();
    };
    // A spatial frame may require dozens of range reads. Continue while real
    // tiles arrive, but terminate after a prolonged idle or bounded total time.
    const checkProgress = () => {
      if (!alive() || frame.ready) return;
      if (spatialFrameTimedOut(Date.now(), startedAt, lastProgressAt)) {
        giveUp();
        return;
      }
      this.pendingTimers.set(step, window.setTimeout(checkProgress, 5_000));
    };
    this.pendingTimers.set(step, window.setTimeout(checkProgress, 5_000));
    for (const [index, layer] of made.entries()) {
      // Track Leaflet tile creation -> painted delivery. WeakMap prevents
      // retaining DOM tile objects after pan/zoom or frame disposal.
      const tileStarts = new WeakMap<HTMLElement, number>();
      layer.on("tileloadstart", (event) => {
        if (alive() && event?.tile) tileStarts.set(event.tile, performance.now());
      });
      // 'tileload' reports ONE tile. 'load' reports that the complete current
      // viewport tile queue has settled. Only the latter may replace fallback.
      layer.on("loading", () => {
        if (!alive()) return;
        frame.loaded[index] = false;
        frame.layerStartedAt[index] = Date.now();
        frame.layerFirstTileAt[index] = 0;
        frame.layerLastTileAt[index] = 0;
        frame.layerFinishedAt[index] = 0;
        // Keep proof of previously delivered tiles: a viewport refresh may
        // reuse cached tiles without firing tileload for each of them.
        frame.errored.delete(index);
        refresh();
      });
      layer.on("load", () => {
        if (!alive()) return;
        frame.loaded[index] = true;
        frame.layerFinishedAt[index] = Date.now();
        refresh();
      });
      layer.on("tileload", (event) => {
        if (!alive()) return;
        if (event?.tile) {
          const started = tileStarts.get(event.tile);
          if (started !== undefined) {
            spatialPerformance.observe("leafletTile", performance.now() - started);
            tileStarts.delete(event.tile);
          }
        }
        frame.tileCounts[index] += 1;
        lastProgressAt = Date.now();
        frame.layerFirstTileAt[index] ||= lastProgressAt;
        frame.layerLastTileAt[index] = lastProgressAt;
        refresh();
      });
      layer.on("tileerror", (ev) => {
        if (!alive()) return;
        const err = (ev as { error?: unknown } | undefined)?.error;
        if (err) this.lastError = String(err instanceof Error ? err.message : err).slice(0, 160);
        frame.errorCounts[index] += 1;
        frame.errored.add(index);
        refresh();
        errors += 1;
        if (errors >= 3) {
          const timer = this.pendingTimers.get(step);
          if (timer !== undefined) window.clearTimeout(timer);
          // An already-rendered frame must be retired on repeated errors,
          // rather than remaining indefinitely marked "ready" on a failed
          // refresh. The backoff path retries the model after 15 seconds.
          frame.ready = false;
          giveUp();
        }
      });
      layer.addTo(map);
    }
  }

  /** الساعة الأقدم تخفت بينما الساعة الأحدث تظهر، فتنساب الكتل بدل القفزة. */
  private applyOpacity() {
    const readySteps = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) readySteps.add(step);
    const cooldown = (this.failedUntil.get(this.base) ?? 0) > Date.now();
    const plan = selectSpatialFramePlan(this.base, this.blend, readySteps, this.lastDisplayedStep, cooldown);
    this.holdingPreviousFrame = plan.holding && plan.anchor !== null;
    // Layer stacking depends on which forecast frames participate, not on
    // the interpolation weight. Including the weight in this key caused
    // Leaflet bringToFront() (DOM reordering of 3–6 image layers) on every
    // playback tick, competing with network tile paint/decode.
    const key = spatialStackKey(plan.goals);
    if (key !== this.orderKey) {
      this.orderKey = key;
      // Explicitly bring the chosen forecast above an older held frame.
      // Never discard the previous frame until a replacement is ready.
      for (const step of plan.goals.keys()) {
        const frame = this.frames.get(step);
        if (!frame?.ready) continue;
        for (const layer of frame.layers) layer.bringToFront?.();
      }
    }
    if (plan.anchor !== null) this.lastDisplayedStep = plan.anchor;
    for (const [step, frame] of this.frames) {
      if (!frame.ready) continue;
      const goal = plan.goals.get(step) ?? 0;
      const cur = frame.opacity < 0 ? 0 : frame.opacity;
      // On a failed model hour the forecast clock is allowed to continue
      // using the matching global field. Hide stale ECMWF imagery immediately
      // instead of letting it linger as a seemingly current cloud pattern.
      const shown = cooldown && goal === 0 ? 0 : cur + (goal - cur) * 0.28;
      const value = Math.abs(goal - shown) < 0.02 ? goal : shown;
      if (Math.abs(frame.opacity - value) < 0.01) continue;
      frame.opacity = value;
      for (const [idx, layer] of frame.layers.entries()) {
        const mode = this.diagnosticMode;
        const allowed = mode === "all" || (mode === "cloud" && idx === 0) ||
          (mode === "rain" && idx === 1) || (mode === "snow" && idx === 2);
        layer.setOpacity?.(allowed ? value : 0);
      }
    }
    const visibleOpacity = Array.from(this.frames.values()).reduce(
      (sum, frame) => sum + (frame.ready ? Math.max(0, frame.opacity) : 0),
      0,
    );
    this.spatialVisible = this.diagnosticMode !== "fallback" && visibleOpacity >= 0.88;
    if (this.spatialVisible) this.onLive?.();
    else this.onMiss?.();
  }

  private clear() {
    for (const step of [...this.frames.keys()]) this.discardFrame(step);
    for (const timer of this.pendingTimers.values()) window.clearTimeout(timer);
    this.pendingTimers.clear();
    this.loading.clear();
  }
}

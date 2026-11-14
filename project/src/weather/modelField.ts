import type { Map as LeafletMap } from "leaflet";
import { spatialFrameReadyDuringRefresh, spatialCloudPreviewReady, modelVariablesReady, SPATIAL_LAYER_COUNT } from "@/weather/modelTileReadiness";
import { selectSpatialFramePlan, spatialStackKey } from "@/weather/modelFrameTimeline";
import { chooseWeatherSource } from "@/weather/modelSourceSwitch";
import { planSpatialRequests, canAdvanceSpatialTime, significantSpatialMove } from "@/weather/modelFrameQueue";
import { SpatialTileReveal, canStageSpatialRefresh, softenSpatialTileArrival, type SpatialTileNode, type SpatialRasterView } from "@/weather/spatialTileReveal";
import { SpatialNativeQueue, spatialNativePriority } from "@/weather/spatialNativeQueue";
import { SpatialRangeCache } from "@/weather/spatialRangeCache";
import { SpatialRangeFlights } from "@/weather/spatialRangeFlights";
import { SpatialRateLimit, SpatialRateLimitError } from "@/weather/spatialRateLimit";
import { spatialTransferBytes } from "@/weather/spatialTransferMetrics";
import { pinSpatialRun, pinnedSpatialTileUrl, type PinnedSpatialRun } from "@/weather/spatialRun";
import { spatialTileOptions, useCompactSpatialTiles } from "@/weather/spatialTilePolicy";
import { shouldReplanSpatialFrame, spatialCoverageChanged } from "@/weather/modelRenderPolicy";
import { spatialViewportBounds } from "@/weather/spatialViewportBounds";
import { spatialZoomNeedsNewCoverage } from "@/weather/spatialZoomCoverage";
import { decideSpatialViewport, type SpatialViewportDecision } from "@/weather/spatialViewportBudget";
import { spatialFrameTimedOut } from "@/weather/spatialWatchdog";
import { spatialLayerTiming, type SpatialLayerTiming } from "@/weather/spatialLayerTelemetry";
import { SpatialPerformance, type SpatialPerformanceSnapshot } from "@/weather/spatialPerformance";
import { SpatialViewportRenderer, type ViewportRendererStats } from "@/weather/spatialViewportRenderer";
import { SpatialRenderGeneration } from "@/weather/spatialRenderGeneration";
import { certifiedCurrentLeafletTiles, type CachedRasterLayer } from "@/weather/spatialLeafletCoverage";
import { CapacitorHttp } from "@capacitor/core";
import {
  addLeafletProtocolSupport,
  defaultOmProtocolSettings,
  omProtocol,
  updateCurrentBounds,
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
  spatialViewportPolicy?: SpatialViewportDecision;
  backend?: "ready-tiles" | "pilot-probing" | "om-on-device";
  pilotFailure?: string | null;
  tinyModelObservations?: number;
  frame: number;
  requestedFrame: number;
  displayedFrame: number | null;
  requestedValidTime: string | null;
  displayedValidTime: string | null;
  /** Source-backed frames participating in an authentic temporal blend. */
  compositedFrames?: { frame: number; validTime: string; opacity: number }[];
  blendFraction?: number;
  holdingPreviousFrame: boolean;
  loaded: boolean[];
  tileCounts: number[];
  errors: number[];
  visibleOpacity: number;
  metadataAvailable: boolean;
  modelRunPinned: boolean;
  modelRunReferenceTime: string | null;
  error: string | null;
  cacheHits: number;
  nativeReads: number;
  sharedRangeReads: number;
  activeSharedRanges: number;
  activeFileProbes: number;
  sharedFileProbes: number;
  layerTimings: SpatialLayerTiming[];
  loadingFrames: number[];
  cacheEligible: number;
  cacheStored: number;
  cacheRejected: number;
  performance: SpatialPerformanceSnapshot;
  viewportRenderer: ViewportRendererStats;
  rateLimitedResponses: number;
  rateLimitRemainingMs: number;
  startupMs: { metadata: number | null; firstCloudReady: number | null; firstCompleteReady: number | null };
};

type AnyLayer = {
  addTo: (map: LeafletMap) => AnyLayer;
  remove: () => void;
  on: (event: string, fn: (ev?: { tile?: HTMLElement }) => void) => void;
  /** Leaflet GridLayer's authoritative current-queue loading state. */
  isLoading?: () => boolean;
  setOpacity?: (opacity: number) => void;
  bringToFront?: () => void;
} & CachedRasterLayer;

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
    [72, 158, 236, 0.65],
    [22, 104, 214, 0.83],
    [14, 158, 86, 0.88],
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
    [154, 204, 251, 0.74],
    [226, 243, 255, 0.90],
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
    [249, 252, 255, 0.11],
    [248, 251, 255, 0.31],
    [244, 249, 255, 0.54],
    [244, 249, 255, 0.68],
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
  // Three current-hour variables, plus up to three during active playback.
  // Upstream defaults to TWO cached states; that evicts one of our three
  // variables every tile and can restart .om Range reads repeatedly.
  // Six entries retain one complete current/next-hour ECMWF frame pair,
  // still bounded independently of the native HTTP block cache.
  return { ...defaultOmProtocolSettings, colorScales, maxStatesWithData: 6 };
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

// Six bounded native reads, with fair priority for visible cloud/rain ranges,
// prevent obsolete snowfall queues from delaying the first useful coverage.
// Do not raise concurrency or bypass provider cooldowns.
const spatialNativeQueue = new SpatialNativeQueue(6);
const spatialPerformance = new SpatialPerformance();
const spatialRangeCache = new SpatialRangeCache();
const spatialRangeFlights = new SpatialRangeFlights<Response>();
const spatialLengthFlights = new SpatialRangeFlights<string | null>();
const spatialRateLimit = new SpatialRateLimit();
let spatialCacheHits = 0;
let spatialNativeReads = 0;
let spatialCacheEligible = 0;
let spatialCacheStored = 0;
let spatialCacheRejected = 0;
const spatialFileLengths = new Map<string, { value: string; expires: number }>();

/** Measure queue wait and native transport independently. These values do NOT
 * include OM-file WASM decoding or worker rasterization; the tileload probe
 * separately measures their combined end-to-end tile pipeline. */
async function measuredNativeRequest(
  signal: AbortSignal | undefined,
  options: Parameters<typeof CapacitorHttp.request>[0],
): Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>> {
  const queued = performance.now();
  let started = queued;
  try {
    const result = await spatialNativeQueue.run(signal, () => {
      started = performance.now();
      spatialRateLimit.assertAllowed();
      spatialNativeReads++;
      return CapacitorHttp.request(options);
    }, spatialNativePriority(options.url));
    const retryAfter = Object.entries(result.headers ?? {})
      .find(([key]) => key.toLowerCase() === "retry-after")?.[1];
    spatialRateLimit.observe(result.status, retryAfter == null ? null : String(retryAfter));
    const bytes = spatialTransferBytes(options.method ?? "GET", result.status, result.headers ?? {}, result.data);
    spatialPerformance.networkRequest(
      started - queued, performance.now() - started,
      bytes, result.status >= 200 && result.status < 400,
    );
    return result;
  } catch (error) {
    // Some Capacitor native transports reject non-2xx responses instead
    // of resolving with a status object. Record a provider cooldown in
    // either case; never treat such a rejection as a reason to retry via WebView.
    if (error && typeof error === "object") {
      const info = error as { status?: unknown; headers?: Record<string, unknown> };
      const status = Number(info.status);
      if (status === 429 || status === 503) {
        const retryAfter = info.headers && Object.entries(info.headers)
          .find(([name]) => name.toLowerCase() === "retry-after")?.[1];
        spatialRateLimit.observe(status, retryAfter == null ? null : String(retryAfter));
      }
    }
    if (!(error instanceof SpatialRateLimitError)) spatialPerformance.networkRequest(started - queued, performance.now() - started, 0, false, !!signal?.aborted);
    throw error;
  }
}

async function pluginSpatial(url: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const range = method === "GET" ? headers.get("range") : null;
  const key = range && /^bytes=\d+-\d+$/i.test(range) ? `${url}|${range}` : null;
  if (!key) return pluginSpatialUnshared(url, init, headers);
  // Separate consumers of one file range share the native fetch while their
  // abort signals remain independent. Return separate readable bodies.
  const response = await spatialRangeFlights.run(
    key, init?.signal ?? undefined,
    (signal) => pluginSpatialUnshared(url, { ...init, signal }, headers),
  );
  return response.clone();
}

async function pluginSpatialUnshared(url: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
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
  const result = await measuredNativeRequest(init?.signal ?? undefined, {
    url,
    method,
    headers: bag,
    responseType: method === "HEAD" ? "text" : "arraybuffer",
    connectTimeout: 20000,
    readTimeout: 25000,
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
    if (bytes.byteLength <= 512 * 1024) {
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
  const now = Date.now();
  // The .om metadata URL changes with each ECMWF run. A TTL alone does not
  // remove old Map entries; cap this process-level cache for long sessions.
  for (const [key, item] of spatialFileLengths) {
    if (item.expires <= now) spatialFileLengths.delete(key);
  }
  const cached = spatialFileLengths.get(url);
  if (cached) return cached.value;
  // The reader may query the same .om file length from several tiles
  // concurrently. Coalesce the native 0-0 probe, keeping callers abortable.
  return spatialLengthFlights.run(`length|${url}`, signal,
    (sharedSignal) => probeLengthUnshared(url, headers, sharedSignal));
}

async function probeLengthUnshared(url: string, headers: Headers, signal?: AbortSignal): Promise<string | null> {
  const bag: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (headerName(key) && key.toLowerCase() !== "range") bag[key] = value;
  });
  bag.Range = "bytes=0-0";
  bag["Accept-Encoding"] = "identity";
  const result = await measuredNativeRequest(signal, {
      url,
      method: "GET",
      headers: bag,
      responseType: "text",
      connectTimeout: 15000,
      readTimeout: 15000,
  });
  const map = result.headers ?? {};
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() !== "content-range" || value == null) continue;
    const total = String(value).match(/\/(\d+)\s*$/)?.[1];
    if (total) {
      if (!spatialFileLengths.has(url) && spatialFileLengths.size >= 48) {
        const oldest = spatialFileLengths.keys().next().value;
        if (oldest !== undefined) spatialFileLengths.delete(oldest);
      }
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
      } catch (error) {
        // Never double-send a 429/Retry-After request through browser fallback:
        // that worsens provider throttling and delays the first real frame.
        if (error instanceof SpatialRateLimitError || spatialRateLimit.remainingMs() > 0) {
          throw new SpatialRateLimitError(spatialRateLimit.remainingMs());
        }
        // A cancelled Leaflet frame must never start another network request.
        if (signal?.aborted) throw new Error("spatial-request-aborted");
        /* Use browser transport only when the native bridge fails otherwise. */
      }
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
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
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    throw new Error("spatial-fetch");
  };
}
function tileUrl(variable: string, index: number, run: PinnedSpatialRun | null): string {
  if (run) return pinnedSpatialTileUrl(run, variable, index);
  // Compatibility-only fallback for a provider missing reference_time.
  // The capture path must not be used for normal, valid ECMWF run metadata.
  const q = new URLSearchParams({
    time_step: `valid_times_${index}`,
    variable,
    interpolation: "linear",
    color_blend: "true",
  });
  return `om://${META}?${q.toString()}`;
}

export class ModelField {
  onLive: (() => void) | null = null;
  onMiss: (() => void) | null = null;

  private map: LeafletMap | null = null;
  private adapter: Adapter | null = null;
  private times: number[] = [];
  private pinnedRun: PinnedSpatialRun | null = null;
  private lastError: string | null = null;
  private base = 0;
  private blend = 0;
  private failedUntil = new Map<number, number>();
  private loading = new Set<number>();
  private pendingTimers = new Map<number, number>();
  private frames = new Map<number, { layers: AnyLayer[]; token: number; opacity: number; ready: boolean; coverageZoom: number | null; requestedZoom: number; invalidateZoom?: (zoom: number, force?: boolean) => void; revalidateCurrentTiles?: () => void; previewReady: boolean; previewMask: number; previewOpacityKey: string; loaded: boolean[]; errored: Set<number>; tileCounts: number[]; errorCounts: number[]; layerStartedAt: number[]; layerFirstTileAt: number[]; layerLastTileAt: number[]; layerFinishedAt: number[]; snowStartTimer?: number; tileGates: SpatialTileReveal[]; renderGeneration: SpatialRenderGeneration; layerGeneration: number[]; revealTimer?: number }>();
  private diagnosticMode: WeatherDiagnosticMode = "all";
  private spatialVisible = false;
  private lastDisplayedStep: number | null = null;
  private holdingPreviousFrame = false;
  private seq = 0;
  private orderKey = "";
  private visible = false;
  private playbackActive = false;
  private sourceBackedFallback = false;
  private fallbackForMissingHour = false;
  private lastSyncAt = 0;
  // Do not re-evaluate the same ECMWF tile scheduler every 50 ms while only
  // the forecast blend opacity changes. Tile load/error events and hour
  // changes still trigger scheduling immediately.
  private lastScheduledAt = 0;
  // Continuous pan refreshes must not reset the prefetch grace window every
  // time Leaflet emits another 'loading' for the same requested hour.
  private refreshBase: number | null = null;
  private refreshSince = 0;
  // A new visible viewport temporarily outranks speculative forecast hours.
  // Both flags are reset when the rain map is hidden/disposed.
  private viewportMoving = false;
  private viewportHoldUntil = 0;
  private viewportSettleUntil = 0;
  private viewportSettleTimer: number | null = null;
  private spatialBudget: SpatialViewportDecision = { allow: true, reason: "regional", rasterSize: 1024 };
  private protocolSettings: ReturnType<typeof modelSettings> | null = null;
  // Android WebView lacks SharedArrayBuffer: avoid showing cloud/rain/snow
  // one by one before a complete same-run ECMWF frame is ready.
  private compactSpatialTiles = false;
  private viewportRenderer: SpatialViewportRenderer | null = null;
  private ready: Promise<void> = Promise.resolve();
  private metadataAbort: AbortController | null = null;
  // First-session readiness timings are read-only and measured on device.
  // They are NOT claimed to isolate WASM decoding from worker rasterization.
  private attachedAt = 0;
  private metadataReadyMs: number | null = null;
  private firstCloudReadyMs: number | null = null;
  private firstCompleteReadyMs: number | null = null;
  private updateBoundsListener: (() => void) | null = null;
  private moveStartListener: (() => void) | null = null;
  private moveEndListener: (() => void) | null = null;
  private moveListener: (() => void) | null = null;

  attach(L: unknown, map: LeafletMap) {
    this.attachedAt = performance.now();
    this.metadataReadyMs = null;
    this.firstCloudReadyMs = null;
    this.firstCompleteReadyMs = null;
    installSpatialFetch();
    this.metadataAbort?.abort();
    if (this.map && this.updateBoundsListener) this.map.off("moveend", this.updateBoundsListener);
    if (this.map && this.moveStartListener) this.map.off("movestart", this.moveStartListener);
    if (this.map && this.moveEndListener) this.map.off("moveend", this.moveEndListener);
    if (this.map && this.moveListener) this.map.off("move", this.moveListener);
    this.viewportMoving = false;
    this.viewportHoldUntil = 0;
    this.compactSpatialTiles = useCompactSpatialTiles(nativeApp(), globalThis.crossOriginIsolated === true);
    // A/B rollback for diagnosing vendor/device-specific worker regressions.
    // Never assume an experimental custom worker is available in every
    // Android System WebView. Missing/failed workers use official OM raster.
    let legacyOverride = false;
    try { legacyOverride = localStorage.getItem("myweather.ecmwfRenderer") === "legacy"; } catch { /* private storage */ }
    this.viewportRenderer?.dispose();
    this.viewportRenderer = new SpatialViewportRenderer(this.compactSpatialTiles && !legacyOverride,
      () => this.base);
    this.map = map;
    this.spatialBudget = this.currentSpatialBudget();
    const metadataAbort = new AbortController();
    this.metadataAbort = metadataAbort;
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
    // This must be installed BEFORE any OM tile layer is created. Without
    // updateCurrentBounds the OM reader defaults to the complete global
    // ECMWF grid for every requested forecast hour and all three variables.
    // The official Open-Meteo Leaflet example uses this exact hook.
    const updateBounds = () => {
      const bounds = map.getBounds();
      updateCurrentBounds(spatialViewportBounds({
        west: bounds.getWest(), south: bounds.getSouth(),
        east: bounds.getEast(), north: bounds.getNorth(),
      }));
    };
    updateBounds();
    // Register before GridLayer moveend listeners: when pan/zoom finishes
    // update the data window before the new weather tiles are requested.
    map.on("moveend", updateBounds);
    this.updateBoundsListener = updateBounds;
    let origin: { lat: number; lng: number; zoom: number } | null = null;
    let latSpan = 0;
    let lonSpan = 0;
    let cancelledSpeculation = false;
    let lastSampleAt = 0;
    const onMoveStart = () => {
      if (!this.visible || this.viewportMoving) return;
      if (this.viewportSettleTimer !== null) {
        window.clearTimeout(this.viewportSettleTimer);
        this.viewportSettleTimer = null;
      }
      this.viewportSettleUntil = 0;
      const b = map.getBounds();
      const center = map.getCenter();
      origin = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
      latSpan = Math.max(0.01, b.getNorth() - b.getSouth());
      lonSpan = Math.max(0.01, b.getEast() - b.getWest());
      cancelledSpeculation = false;
      lastSampleAt = 0;
      this.viewportMoving = true;
    };
    const onMove = () => {
      // A user jumping across continents must retire old-hour speculative
      // .om reads even when the visible hour is still decoding. The old
      // ready-only guard left huge stale future-hour datasets in flight,
      // competing with the viewport the user actually requested.
      if (!this.visible || !this.viewportMoving || !origin || cancelledSpeculation) return;
      const now = performance.now();
      if (now - lastSampleAt < 90) return;
      lastSampleAt = now;
      const center = map.getCenter();
      if (!significantSpatialMove(origin,
          { lat: center.lat, lng: center.lng, zoom: map.getZoom() }, latSpan, lonSpan)) return;
      cancelledSpeculation = true;
      // Cancel speculative *model hours* only on significant region changes.
      // Already rendered requested-hour tiles stay onscreen during movement.
      for (const step of [...this.loading]) {
        if (step !== this.base) this.discardFrame(step);
      }
    };
    const onMoveEnd = () => {
      // Evaluate FINAL camera displacement even if 'move' sampling was
      // throttled within 90ms (a fast fling can otherwise look "small").
      // A major same-zoom change must cause a genuinely new Leaflet tile
      // generation, not just reset counters on existing cached DOM tiles.
      if (origin && !cancelledSpeculation) {
        const center = map.getCenter();
        cancelledSpeculation = significantSpatialMove(origin,
          { lat: center.lat, lng: center.lng, zoom: map.getZoom() }, latSpan, lonSpan);
      }
      onMove();
      this.viewportMoving = false;
      origin = null;
      // The spatial model is a regional product on constrained WebViews.
      // Never start another continent-sized .om read during a zoomed-out
      // world tour: fully retire its layers and use the real global fallback.
      const wasAllowed = this.spatialBudget.allow;
      this.refreshSpatialBudget();
      if (!this.spatialBudget.allow) return;
      // The next settled viewport is a single decoding generation. Repeated
      // moveend events during a continental fling must not immediately
      // restart and abort a new expensive current-hour .om read.
      this.viewportSettleUntil = Date.now() + 260;
      if (this.viewportSettleTimer !== null) window.clearTimeout(this.viewportSettleTimer);
      this.viewportSettleTimer = window.setTimeout(() => {
        this.viewportSettleTimer = null;
        if (!this.visible || this.viewportMoving) return;
        this.viewportSettleUntil = 0;
        this.frames.get(this.base)?.revalidateCurrentTiles?.();
        this.pump();
      }, 275);
      if (!wasAllowed) {
        this.pump();
        return;
      }
      // Every pan/zoom begins a new viewport generation. Old completed
      // cloud/rain/snow events must not authorize a new raster reveal.
      for (const frame of this.frames.values()) {
        frame.tileGates.forEach((gate) => gate.release());
        if (frame.revealTimer !== undefined) window.clearTimeout(frame.revealTimer);
        frame.revealTimer = undefined;
        // A Leaflet layer can remain in flight throughout a pan. Rebase
        // that layer's eventual 'load' event into the new viewport instead
        // of invalidating it forever and keeping ECMWF hidden by fallback.
        const incomplete = frame.loaded.flatMap((done, index) => done ? [] : [index]);
        const adopted = frame.renderGeneration.begin(incomplete);
        for (const index of incomplete) frame.layerGeneration[index] = adopted;
      }
      // A new zoom invalidates the raster of ALL old forecast hours. Do
      // not trigger 3 expensive variable reads for each hidden lookahead
      // hour: keep the requested hour, retire unrelated forecast layers,
      // and let the normal bounded scheduler prefetch once the view settles.
      // Same-zoom drags retain their buffered tiles unchanged.
      const zoom = map.getZoom();
      const zoomChanged = [...this.frames.values()].some(frame =>
        spatialZoomNeedsNewCoverage(frame.requestedZoom, zoom));
      // A large same-zoom pan is ALSO a new coverage generation. The old
      // code only invalidated on zoom, so frame.ready remained true while
      // independently loaded cloud/rain/snow tiles painted old areas or
      // left black/rectangular holes over a supposedly complete frame.
      const majorCoverageChange = zoomChanged || cancelledSpeculation;
      if (majorCoverageChange) {
        // Root cause of the user's new 0/0/0 trace: invalidateZoom(force)
        // zeroed three tile counters without remounting the Leaflet grids.
        // Reused/cached canvas tiles never fire new 'tileload' events, so the
        // frame stays unready forever even though all fields decoded before.
        // A new full viewport generation MUST also own fresh GridLayer
        // instances. One requested model hour is mounted; old lookahead
        // frames and obsolete reads are retired atomically.
        for (const step of [...this.frames.keys()]) this.discardFrame(step);
        this.orderKey = "";
        this.spatialVisible = false;
        this.holdingPreviousFrame = false;
        this.onMiss?.();
        if (this.visible) this.pump();
        return;
      }
      if (!this.visible || !this.frames.get(this.base)?.ready) {
        if (this.visible) this.pump();
        return;
      }
      // GridLayer's 'loading' may be emitted after this moveend callback.
      // Give it time to request the newly visible viewport before prefetch
      // can start again, without adding a periodic timer or another redraw.
      this.viewportHoldUntil = Date.now() + 450;
      this.refreshBase = this.base;
      this.refreshSince = Date.now();
      this.pump();
    };
    map.on("movestart", onMoveStart);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    this.moveStartListener = onMoveStart;
    this.moveListener = onMove;
    this.moveEndListener = onMoveEnd;
    this.adapter = addLeafletProtocolSupport(L as never) as unknown as Adapter;
    this.protocolSettings = modelSettings();
    this.protocolSettings.maxStatesWithData =
      this.compactSpatialTiles && this.spatialBudget.rasterSize <= 512 ? 4 : 6;
    this.adapter.addProtocol("om", this.viewportRenderer?.handler ?? omProtocol, this.protocolSettings);
    this.lastError = null;
    this.pinnedRun = null;
    this.ready = fetch(META, { signal: metadataAbort.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { reference_time?: string; valid_times?: string[]; variables?: string[] }) => {
        if (metadataAbort.signal.aborted || this.map !== map) return;
        this.metadataReadyMs = performance.now() - this.attachedAt;
        // Do not launch a partly available spatial frame: it would suppress
        // the global snowfall field even if the ECMWF snow file is absent.
        if (!modelVariablesReady(json.variables)) {
          this.lastError = "ECMWF model missing one or more cloud/rain/snow variables";
          console.warn("MyWeather: ECMWF spatial layer unavailable; retaining global rain/snow fallback");
          this.times = [];
          return;
        }
        // Resolve one immutable run for the entire time animation.
        // The Capture API resolves latest.json separately per layer/tile and
        // can change runs mid-playback after its 60-second metadata TTL.
        // Keep identical run and valid time across clouds, rain and snow.
        this.pinnedRun = pinSpatialRun(json);
        this.times = this.pinnedRun
          ? [...this.pinnedRun.validTimes]
          : (json.valid_times ?? []).map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
      })
      .catch((error: unknown) => {
        if (metadataAbort.signal.aborted || this.map !== map) return;
        this.lastError = String(error instanceof Error ? error.message : error).slice(0, 160);
        console.warn("MyWeather: spatial metadata fetch failed", this.lastError);
        this.times = [];
      });
  }

  whenReady(): Promise<number> {
    return this.ready.then(() => this.times.length);
  }

  /** Whether a complete ECMWF spatial image currently covers the rain map.
   * The separate Open-Meteo regional fallback does not need to fetch while
   * this is true; the already loaded fallback grid remains intact. */
  isSpatialVisible(): boolean {
    return this.visible && this.spatialBudget.allow && this.spatialVisible;
  }

  private currentSpatialBudget(): SpatialViewportDecision {
    if (!this.map) return { allow: false, reason: "invalid", rasterSize: 256 };
    const b = this.map.getBounds();
    return decideSpatialViewport({
      zoom: this.map.getZoom(), west: b.getWest(), east: b.getEast(),
      south: b.getSouth(), north: b.getNorth(),
    });
  }

  private refreshSpatialBudget(): void {
    const next = this.currentSpatialBudget();
    const previous = this.spatialBudget;
    this.spatialBudget = next;
    // A broad world view uses four cached data states (three live variables
    // and one lookahead) instead of holding six 26MiB buffers on mobile.
    if (this.protocolSettings) {
      this.protocolSettings.maxStatesWithData =
        this.compactSpatialTiles && next.rasterSize <= 512 ? 4 : 6;
    }
    const sampleChanged = this.compactSpatialTiles && previous.rasterSize !== next.rasterSize;
    if (next.allow === previous.allow && !sampleChanged) return;
    // Retire in-flight model hours only when the sampling level changes
    // or the viewport is invalid. Never disable ECMWF just for zoom <=5.
    this.clear();
    this.viewportRenderer?.clear();
    this.failedUntil.clear();
    this.orderKey = "";
    this.lastDisplayedStep = null;
    this.holdingPreviousFrame = false;
    this.spatialVisible = false;
    this.fallbackForMissingHour = false;
    this.refreshBase = null;
    this.refreshSince = 0;
    this.lastScheduledAt = 0;
    if (this.visible) this.onMiss?.();
  }

  /** Playback safety gate for the rain/snow map only. Frame decoding is
   * bounded; hold playback at a temporal boundary until ECMWF can show it.
   * Never freeze playback permanently when the upstream request is in cooldown. */
  canAdvanceTo(ms: number): boolean {
    if (!this.visible || !this.times.length || !this.spatialBudget.allow) return true;
    // Keep the forecast clock steady during panning; a successful forecast
    // from the PREVIOUS viewport cannot authorize advancing the timeline.
    if (this.viewportMoving || Date.now() < this.viewportSettleUntil) return false;
    const { i } = this.bracket(ms);
    const ready = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) ready.add(step);
    const blocked = new Set<number>();
    for (const [step, until] of this.failedUntil) if (until > Date.now()) blocked.add(step);
    return canAdvanceSpatialTime(i, ready, blocked, this.loading, this.sourceBackedFallback);
  }

  setSourceBackedFallback(available: boolean) {
    if (this.sourceBackedFallback === available) return;
    this.sourceBackedFallback = available;
    if (this.visible && this.spatialBudget.allow) this.applyOpacity();
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
    const contributors = [...this.frames.entries()]
      .filter(([step, frame]) => frame.ready && frame.opacity > 0.01 && this.times[step] != null)
      .sort((a, b) => b[1].opacity - a[1].opacity);
    const displayed = contributors[0]?.[0] ?? null;
    const frame = this.frames.get(this.base) ?? this.frames.get(this.base + 1);
    return {
      mode: this.diagnosticMode,
      source: this.spatialVisible ? "spatial" : "fallback",
      spatialViewportPolicy: this.spatialBudget,
      frame: this.base,
      requestedFrame: this.base,
      displayedFrame: this.spatialVisible ? displayed : null,
      requestedValidTime: this.times[this.base] != null ? new Date(this.times[this.base]).toISOString() : null,
      displayedValidTime: this.spatialVisible && displayed !== null && this.times[displayed] != null
        ? new Date(this.times[displayed]).toISOString() : null,
      compositedFrames: this.spatialVisible
        ? contributors.map(([step, item]) => ({
            frame: step, validTime: new Date(this.times[step]!).toISOString(),
            opacity: Number(item.opacity.toFixed(3)),
          })) : [],
      blendFraction: Number(this.blend.toFixed(3)),
      holdingPreviousFrame: this.holdingPreviousFrame,
      loaded: frame?.loaded.slice() ?? [false, false, false],
      tileCounts: frame?.tileCounts.slice() ?? [0, 0, 0],
      errors: frame?.errorCounts.slice() ?? [0, 0, 0],
      visibleOpacity: frame?.opacity ?? 0,
      metadataAvailable: this.times.length > 0,
      modelRunPinned: this.pinnedRun !== null,
      modelRunReferenceTime: this.pinnedRun ? new Date(this.pinnedRun.referenceTime).toISOString() : null,
      error: this.lastError,
      cacheHits: spatialCacheHits,
      nativeReads: spatialNativeReads,
      sharedRangeReads: spatialRangeFlights.joined,
      activeSharedRanges: spatialRangeFlights.active,
      activeFileProbes: spatialLengthFlights.active,
      sharedFileProbes: spatialLengthFlights.joined,
      cacheEligible: spatialCacheEligible,
      cacheStored: spatialCacheStored,
      cacheRejected: spatialCacheRejected,
      viewportRenderer: this.viewportRenderer?.snapshot() ?? {
        mode: "legacy", workerTiles: 0, fallbackTiles: 0, datasetCopies: 0,
        datasetReuses: 0, datasetEvictions: 0, workerSlots: 0, capturedReadRecoveries: 0,
        queued: 0, peakWaiting: 0, reasons: {
          missingData: 0, oversizedData: 0, admissionSaturated: 0,
          admissionDeadline: 0, workerFailure: 0, other: 0,
        }, readP50Ms: null, readP95Ms: null, workerQueueP95Ms: null,
        renderP50Ms: null, renderP95Ms: null,
      },
      performance: spatialPerformance.snapshot(
        globalThis.crossOriginIsolated === true,
        (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize ?? null,
      ),
      rateLimitedResponses: spatialRateLimit.incidents,
      rateLimitRemainingMs: spatialRateLimit.remainingMs(),
      startupMs: {
        metadata: this.metadataReadyMs,
        firstCloudReady: this.firstCloudReadyMs,
        firstCompleteReady: this.firstCompleteReadyMs,
      },
      layerTimings: Array.from({ length: SPATIAL_LAYER_COUNT }, (_, index) =>
        spatialLayerTiming(Date.now(), frame?.layerStartedAt[index] ?? 0,
          frame?.layerFirstTileAt[index] ?? 0, frame?.layerLastTileAt[index] ?? 0,
          frame?.layerFinishedAt[index] ?? 0)),
      loadingFrames: [...this.loading].sort((a, b) => a - b),
    };
  }

  /** Priority changes only; never remount completed frames on play/pause. */
  setPlaybackActive(on: boolean) {
    if (this.playbackActive === on) return;
    this.playbackActive = on;
    if (on && this.visible && this.times.length) this.pump();
  }

  setVisible(on: boolean) {
    if (this.visible === on) return;
    this.visible = on;
    if (on && !this.spatialBudget.allow) this.onMiss?.();
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
      this.viewportMoving = false;
      this.viewportHoldUntil = 0;
      this.playbackActive = false;
      this.lastScheduledAt = 0;
      this.fallbackForMissingHour = false;
      this.clear();
      this.viewportRenderer?.clear();
    }
  }

  sync(ms: number) {
    if (!this.visible || !this.spatialBudget.allow) return;
    // Forecast tile management does not need to run at the 60fps WebGL cadence.
    const now = performance.now();
    if (now - this.lastSyncAt < 50) return;
    this.lastSyncAt = now;
    installSpatialFetch();
    void this.ready.then(() => {
      if (!this.visible || !this.adapter || !this.map || !this.times.length) return;
      const { i, f } = this.bracket(ms);
      const hourChanged = i !== this.base;
      this.base = i;
      this.blend = f;
      // The animation blend continues at 20Hz, but planning/canceling work
      // cannot become a hot loop while tiles decode or the slider is held.
      // Poll every 500ms so the bounded viewport priority deadline and
      // failed-provider cooldown are still observed.
      if (shouldReplanSpatialFrame(hourChanged, now, this.lastScheduledAt)) {
        this.lastScheduledAt = now;
        this.pump();
      }
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
    if (!this.visible || !this.spatialBudget.allow || !this.adapter || !this.map ||
        this.viewportMoving || Date.now() < this.viewportSettleUntil) return;
    const ready = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) ready.add(step);
    const blocked = new Set<number>();
    for (const [step, until] of this.failedUntil) if (until > Date.now()) blocked.add(step);
    // Favor the visible tile queues before speculative forecast hours; do
    // not restart this clock for every tile 'loading' event. The bounded
    // grace still lets playback prepare the next hour on slow connections.
    const current = this.frames.get(this.base);
    const now = Date.now();
    const viewportRefreshing = !!current?.ready && (
      this.viewportMoving || now < this.viewportHoldUntil ||
      current.loaded.some((complete) => !complete)
    );
    if (!viewportRefreshing) {
      this.refreshBase = null;
      this.refreshSince = 0;
    } else if (this.refreshBase !== this.base || !this.refreshSince) {
      this.refreshBase = this.base;
      this.refreshSince = now;
    }
    const refreshAge = viewportRefreshing ? now - this.refreshSince : 0;
    const plan = planSpatialRequests(
      this.base, this.times.length, ready, this.loading, blocked, viewportRefreshing, refreshAge, this.playbackActive, this.viewportMoving, this.compactSpatialTiles,
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
    if (frame?.snowStartTimer !== undefined) window.clearTimeout(frame.snowStartTimer);
    if (frame?.revealTimer !== undefined) window.clearTimeout(frame.revealTimer);
    frame?.tileGates.forEach((gate) => gate.release());
    if (frame) {
      frame.invalidateZoom = undefined;
      frame.revalidateCurrentTiles = undefined;
    }
    this.frames.delete(step);
    this.loading.delete(step);
    // Removed Leaflet layers abort outstanding tile tasks. Their asynchronous
    // callbacks are ignored because their frame is no longer in the map.
    frame?.layers.forEach((layer) => layer.remove());
  }

  private dropFar(i: number) {
    // Two-hour lookahead is prepared one at a time, and retained until used.
    // At most three adjacent spatial hours plus the last fading frame remain.
    const keep = new Set([i, i + 1, i + 2]);
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
    const cloudOpts = spatialTileOptions("wx-clouds", this.compactSpatialTiles);
    const rainOpts = spatialTileOptions("wx-model", this.compactSpatialTiles);
    const renderUrl = (variable: string) => {
      const url = tileUrl(variable, step, this.pinnedRun);
      // The upstream Leaflet adapter draws an ImageBitmap of ANY size into
      // its original 1024px canvas via drawImage(bitmap,0,0,tileSize,tileSize).
      // Fewer samples per world-scale tile preserve genuine ECMWF data and
      // original map geography while reducing CPU render work by 4x–16x.
      return this.compactSpatialTiles ? `${url}&tile_size=${this.spatialBudget.rasterSize}` : url;
    };
    const made = [
      adapter.createTileLayer(renderUrl("cloud_cover"), cloudOpts),
      adapter.createTileLayer(renderUrl("precipitation"), rainOpts),
      adapter.createTileLayer(renderUrl("snowfall_water_equivalent"), rainOpts),
    ] as AnyLayer[];
    // DOM canvases that actually emitted a tileload in THIS model hour.
    // Leaflet can retain/reuse them after a pan without another tileload.
    const certifiedTiles = Array.from({ length: SPATIAL_LAYER_COUNT },
      () => new WeakSet<object>());
    const frame = {
      layers: made, token, opacity: -1, ready: false, coverageZoom: null as number | null, requestedZoom: map.getZoom(),
      invalidateZoom: undefined as ((zoom: number, force?: boolean) => void) | undefined,
      revalidateCurrentTiles: undefined as (() => void) | undefined,
      previewReady: false, previewMask: 0, previewOpacityKey: "",
      loaded: Array<boolean>(SPATIAL_LAYER_COUNT).fill(false),
      errored: new Set<number>(),
      tileCounts: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      errorCounts: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerStartedAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerFirstTileAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerLastTileAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      layerFinishedAt: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      snowStartTimer: undefined as number | undefined,
      tileGates: Array.from({ length: SPATIAL_LAYER_COUNT }, () => new SpatialTileReveal()),
      renderGeneration: new SpatialRenderGeneration(),
      layerGeneration: Array<number>(SPATIAL_LAYER_COUNT).fill(0),
      revealTimer: undefined as number | undefined,
    };
    this.frames.set(step, frame);
    if (!this.anyReady()) this.onMiss?.();
    let errors = 0;
    let startedAt = Date.now();
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
      // Keep current genuine fallback until all three ECMWF layers finish,
      // rather than visibly replacing them in three separate passes.
      const preview = !this.compactSpatialTiles &&
        spatialCloudPreviewReady(frame.previewReady, frame.loaded, frame.errored, frame.tileCounts);
      const previewMask = frame.loaded.reduce((mask, complete, index) =>
        complete && frame.tileCounts[index]! > 0 && !frame.errored.has(index)
          ? mask | (1 << index) : mask, 0);
      const previewChanged = frame.previewReady !== preview || frame.previewMask !== previewMask;
      frame.previewReady = preview;
      frame.previewMask = previewMask;
      // Measure when the cloud field really finishes, not when policy allows
      // the cloud-only preview to be shown. This keeps mobile QA timings
      // comparable after the synchronized three-layer display change.
      if (step === this.base && this.firstCloudReadyMs === null &&
          frame.loaded[0] && frame.tileCounts[0]! > 0 && !frame.errored.has(0)) {
        this.firstCloudReadyMs = performance.now() - this.attachedAt;
      }
      // A completed successful reload clears stale timeout errors, even when
      // the previous frame already remained visible during the refresh.
      if (frame.loaded.every(Boolean) && frame.errored.size === 0 && frame.tileCounts.every((n) => n > 0)) {
        this.lastError = null;
      }
      if (ready === frame.ready) {
        // On a successful viewport refresh the existing frame stays visible;
        // resume prefetch once all queues finish, without hiding its imagery.
        if (ready && frame.loaded.every(Boolean)) this.pump();
        // First real cloud tiles can paint immediately while rain/snow finish.
        // Avoid repainting on every individual tileload event.
        if (previewChanged && step === this.base) this.applyOpacity();
        return;
      }
      // Cloud preview may already have opacity=1. Force a single repaint
      // when the final rain/snow layer completes, otherwise the interpolation
      // early-exit would leave that newly finished layer at opacity=0.
      if (ready && !frame.ready && frame.opacity > 0.98) frame.opacity = 0.975;
      frame.ready = ready;
      this.orderKey = "";
      if (ready) {
        frame.coverageZoom = map.getZoom();
        frame.requestedZoom = map.getZoom();
        if (step === this.base && this.firstCompleteReadyMs === null) {
          this.firstCompleteReadyMs = performance.now() - this.attachedAt;
        }
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
      if (!ready && !preview) {
        frame.opacity = 0;
        for (const layer of made) layer.setOpacity?.(0);
      }
      this.applyOpacity();
    };
    const giveUp = () => {
      if (!alive() || frame.ready) return;
      // Failed frames are retryable: avoid a permanent weather outage after
      // one transient fetch error or a quick network switch.
      this.failedUntil.set(step, Date.now() + 15_000);
      this.lastError = frame.errored.size ? "ECMWF tile request failed" : "ECMWF tile readiness timeout";
      if (frame.errored.size) {
        console.warn("MyWeather: incomplete ECMWF spatial frame; retrying", { frame: step, errors: frame.errored.size });
      }
      this.discardFrame(step);
      // Recompute spatialVisible after discarding even a partial cloud
      // preview. A stale true value suppressed fallback recovery after
      // a provider timeout while no complete forecast frame existed.
      this.applyOpacity();
      this.pump();
    };
    // A spatial frame may require dozens of range reads. Continue while real
    // tiles arrive, but terminate after a prolonged idle or bounded total time.
    const checkProgress = () => {
      if (!alive() || frame.ready) return;
      // Leaflet may finish its active tile queue while a moveend has
      // invalidated the former generation's load callback. Recover only
      // when real tiles for THIS layer were delivered and GridLayer reports
      // no pending tile requests. Never fabricate an ECMWF completion.
      let recovered = false;
      for (const [index, layer] of made.entries()) {
        if (frame.loaded[index] && frame.tileCounts[index]! > 0) continue;
        if (frame.errored.has(index) || layer.isLoading?.() !== false) continue;
        // Detect genuinely reusable current-viewport canvases. A Leaflet
        // GridLayer can have all necessary tiles cached and emit NO new
        // tileload/load after moveend, leaving the old epoch permanently
        // false. Only previously certified DOM tiles at the CURRENT zoom
        // may satisfy the new epoch; an unrelated tile count cannot.
        const cachedCount = certifiedCurrentLeafletTiles(
          layer, map.getZoom(), certifiedTiles[index]!);
        if (!cachedCount && frame.layerLastTileAt[index] === 0) continue;
        const token = frame.layerGeneration[index]!;
        if (!frame.renderGeneration.loaded(index, token)) continue;
        frame.tileCounts[index] = Math.max(frame.tileCounts[index]!, cachedCount);
        frame.loaded[index] = true;
        frame.layerFinishedAt[index] = Date.now();
        recovered = true;
      }
      if (recovered) {
        if (frame.renderGeneration.ready() && frame.loaded.every(Boolean)) {
          frame.tileGates.forEach((gate) => gate.release());
        }
        refresh();
      }
      if (frame.ready) return;
      if (spatialFrameTimedOut(Date.now(), startedAt, lastProgressAt)) {
        giveUp();
        return;
      }
      this.pendingTimers.set(step, window.setTimeout(checkProgress, 1_500));
    };
    // Recover cached canvases promptly, not after an apparent five-second
    // blank interval. This is a metadata-only check, not an extra .om read.
    frame.revalidateCurrentTiles = checkProgress;
    this.pendingTimers.set(step, window.setTimeout(checkProgress, 1_000));
    frame.invalidateZoom = (zoom, force = false) => {
      if (!alive() || (!force && !spatialZoomNeedsNewCoverage(frame.requestedZoom, zoom))) return;
      frame.requestedZoom = zoom;
      // A newly zoomed viewport must not inherit a historical layer's
      // cumulative tile count. That marked a frame ready with zero new
      // delivered tiles and left broken rectangular ECMWF patches.
      frame.coverageZoom = null;
      frame.ready = false;
      frame.previewReady = false;
      frame.previewMask = 0;
      frame.previewOpacityKey = "";
      frame.opacity = 0;
      frame.loaded.fill(false);
      frame.tileCounts.fill(0);
      frame.layerFirstTileAt.fill(0);
      frame.layerLastTileAt.fill(0);
      frame.tileGates.forEach(gate => gate.release());
      const epoch = frame.renderGeneration.begin([0, 1, 2]);
      frame.layerGeneration.fill(epoch);
      for (const layer of made) layer.setOpacity?.(0);
      this.loading.add(step);
      this.orderKey = "";
      startedAt = Date.now();
      lastProgressAt = startedAt;
      const old = this.pendingTimers.get(step);
      if (old !== undefined) window.clearTimeout(old);
      this.pendingTimers.set(step, window.setTimeout(checkProgress, 5_000));
      // Existing physical image tile requests continue. No remount, duplicate
      // network request or extra worker is introduced for the zoom transition.
      this.applyOpacity();
    };
    const rasterView = (): SpatialRasterView => {
      const b = map.getBounds();
      return { west: b.getWest(), east: b.getEast(), south: b.getSouth(),
        north: b.getNorth(), zoom: map.getZoom() };
    };
    for (const [index, layer] of made.entries()) {
      const tileStart = new WeakMap<object, number>();
      const tileGate = frame.tileGates[index]!;
      let refreshBatch = false;
      let lastCompletedView: SpatialRasterView | null = null;
      layer.on("tileloadstart", (event) => {
        if (!alive() || !event?.tile) return;
        tileStart.set(event.tile, performance.now());
        // During a viewport refresh, Leaflet independently inserts rendered
        // images. Stage only new tiles until this layer's 'load', so hard
        // rectangular fragments do not appear over the previous coverage.
        if (refreshBatch) tileGate.hold(event.tile as SpatialTileNode);
      });
      layer.on("tileunload", (event) => {
        tileGate.discard(event?.tile as SpatialTileNode | undefined);
      });
      // 'tileload' reports ONE tile. 'load' reports that the complete current
      // viewport tile queue has settled. Only the latter may replace fallback.
      layer.on("loading", () => {
        if (!alive()) return;
        // Staging helps only when the old image still covers the same zoom.
        // A large move or pinch invalidates previous tile coverage; show new
        // tiles as they decode instead of hiding the screen for 8+ seconds.
        // A new loading generation supersedes the old state for this
        // particular variable, even if other variables still show old tiles.
        frame.layerGeneration[index] = frame.renderGeneration.loading(index);
        if (frame.revealTimer !== undefined) window.clearTimeout(frame.revealTimer);
        frame.revealTimer = undefined;
        refreshBatch = (frame.ready || frame.previewReady) &&
          canStageSpatialRefresh(lastCompletedView, rasterView());
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
        if (!alive() || !frame.renderGeneration.loaded(index, frame.layerGeneration[index]!)) return;
        // Publish one generation only after every layer with new work
        // settles. A short coalescing window catches overlapping 'loading'
        // events from Leaflet's three independent raster grids.
        refreshBatch = false;
        if (frame.tileCounts[index]! > 0) lastCompletedView = rasterView();
        frame.loaded[index] = true;
        frame.layerFinishedAt[index] = Date.now();
        if (frame.renderGeneration.ready() && frame.loaded.every(Boolean)) {
          if (frame.revealTimer !== undefined) window.clearTimeout(frame.revealTimer);
          const expected = frame.renderGeneration.id;
          frame.revealTimer = window.setTimeout(() => {
            frame.revealTimer = undefined;
            if (alive() && expected === frame.renderGeneration.id && frame.renderGeneration.ready()) {
              frame.tileGates.forEach((gate) => gate.release());
            }
          }, 85);
        }
        refresh();
      });
      layer.on("tileload", (event) => {
        if (!alive()) return;
        // Never gate the entire viewport again: the strict barrier caused a
        // 32.8s first-frame regression on the tested Android WebView. Soften
        // only genuine newly decoded overlay tiles on large pan/zoom updates.
        softenSpatialTileArrival(event?.tile as SpatialTileNode | undefined,
          frame.ready && frame.opacity > 0.15 && !refreshBatch,
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
        const since = event?.tile ? tileStart.get(event.tile) : undefined;
        if (since !== undefined) {
          spatialPerformance.tile(index, performance.now() - since, true);
          tileStart.delete(event!.tile!);
        }
        frame.tileCounts[index] += 1;
        if (event?.tile) certifiedTiles[index]!.add(event.tile);
        lastProgressAt = Date.now();
        frame.layerFirstTileAt[index] ||= lastProgressAt;
        frame.layerLastTileAt[index] = lastProgressAt;
        refresh();
      });
      layer.on("tileerror", (ev) => {
        if (!alive()) return;
        spatialPerformance.tile(index, 0, false);
        const err = (ev as { error?: unknown } | undefined)?.error;
        if (err) this.lastError = String(err instanceof Error ? err.message : err).slice(0, 160);
        frame.errorCounts[index] += 1;
        frame.errored.add(index);
        // Never hold a staged raster indefinitely when any tile errors.
        if (frame.revealTimer !== undefined) window.clearTimeout(frame.revealTimer);
        frame.revealTimer = undefined;
        frame.tileGates.forEach((gate) => gate.release());
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
      // Prioritize first real cloud/rain coverage. A bounded 650-ms delay
      // in mounting snowfall avoids starting all three costly OM worker
      // decoders at once; snow is never skipped or fabricated.
      if (index < 2) layer.addTo(map);
    }
    let snowStarted = false;
    const mountSnow = () => {
      if (!alive() || snowStarted) return;
      snowStarted = true;
      if (frame.snowStartTimer !== undefined) window.clearTimeout(frame.snowStartTimer);
      frame.snowStartTimer = undefined;
      made[2]!.addTo(map);
    };
    // If cloud tiles arrive sooner, start snowfall immediately. Otherwise
    // the bounded deadline guarantees snow is requested even on a slow link.
    made[0]!.on("tileload", mountSnow);
    frame.snowStartTimer = window.setTimeout(mountSnow, 650);
  }

  /** الساعة الأقدم تخفت بينما الساعة الأحدث تظهر، فتنساب الكتل بدل القفزة. */
  private applyOpacity() {
    if (!this.spatialBudget.allow) return;
    const readySteps = new Set<number>();
    for (const [step, frame] of this.frames) if (frame.ready) readySteps.add(step);
    const cooldown = (this.failedUntil.get(this.base) ?? 0) > Date.now();
    // An actual fallback has its own time-aligned precipitation field.
    // Never hold an obsolete ECMWF hour over a new fallback forecast hour.
    // A real Open-Meteo fallback and ECMWF are separate forecast products.
    // Do not cross-fade their coarse/fine raster imagery: the overlap is seen
    // as rectangular cloud/rain patches during fast pans and time playback.
    const { fallback: fallbackForHour, snapCompleteModel: returningToReadyModel } =
      chooseWeatherSource(readySteps.has(this.base), this.sourceBackedFallback, this.fallbackForMissingHour);
    this.fallbackForMissingHour = fallbackForHour;
    const plan = fallbackForHour
      ? { goals: new Map<number, number>(), anchor: null, holding: false }
      : selectSpatialFramePlan(this.base, this.blend, readySteps, this.lastDisplayedStep, cooldown);
    // A first completed cloud viewport should not be held hostage by slow
    // precipitation/snowfall .om decoding. Only source-backed, fully loaded
    // individual layers are shown; partially loaded image tiles remain hidden.
    const requested = this.frames.get(this.base);
    // The original quick first-paint still matters: show only a complete
    // source-backed ECMWF CLOUD preview before any full model hour is ready.
    // While real rain/snow fallback is active, never show partial ECMWF
    // precipitation simultaneously. During playback, require full 3-layer
    // frames to avoid jumping between incompatible source products.
    // Do not expose a partial ECMWF cloud tile over an Open-Meteo
    // fallback: they are different model products and the overlap shows
    // as hard rectangular cloud patches when the viewport is moving.
    // An early ECMWF cloud preview remains possible when there is no
    // competing source-backed fallback currently on the screen.
    const preview = !fallbackForHour && !cooldown && plan.goals.size === 0 && requested &&
      !requested.ready && requested.previewReady ? requested : null;
    this.holdingPreviousFrame = plan.holding && plan.anchor !== null && !preview;
    for (const [step, frame] of this.frames) {
      if (frame.ready || frame.opacity <= 0 || (preview === frame && step === this.base)) continue;
      frame.opacity = 0;
      frame.previewOpacityKey = "";
      for (const layer of frame.layers) layer.setOpacity?.(0);
    }
    if (preview) {
      preview.opacity = 1;
      // Leaflet.setOpacity() traverses tile elements. Do it only when a
      // particular source finishes or diagnostic mode changes, NOT at 20Hz.
      const opacityKey = `${this.diagnosticMode}:${preview.previewMask}:${preview.previewReady}:${fallbackForHour}`;
      if (preview.previewOpacityKey !== opacityKey) {
        preview.previewOpacityKey = opacityKey;
        preview.layers.forEach((layer, idx) => {
        // Leaflet keeps its prior cloud images in the DOM while refreshing a
        // moved viewport. Do not hide that proven image on a new loading event.
        const complete = preview.tileCounts[idx]! > 0 && !preview.errored.has(idx) &&
          (preview.loaded[idx] || (idx === 0 && preview.previewReady));
        const mode = this.diagnosticMode;
        const allowed = mode === "all" || (mode === "cloud" && idx === 0) ||
          (mode === "rain" && idx === 1) || (mode === "snow" && idx === 2);
        layer.setOpacity?.(complete && allowed && (!fallbackForHour || idx === 0) ? 1 : 0);
        });
      }
    }
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
      // Switching between unrelated data products must be atomic, not
      // intermediate alpha=0.5 ECMWF atop alpha=1 fallback. Keep normal
      // temporal interpolation between fully ready ECMWF forecast hours.
      const shown = fallbackForHour || returningToReadyModel ? goal :
        cooldown && goal === 0 ? 0 : cur + (goal - cur) * 0.28;
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
    // Cloud-only previews must not hide the real precipitation/snow fallback.
    // A complete ECMWF frame is required before turning it off.
    const completedOpacity = Array.from(this.frames.values()).reduce(
      (sum, frame) => sum + (frame.ready ? Math.max(0, frame.opacity) : 0), 0,
    );
    const nextVisible = !fallbackForHour && this.diagnosticMode !== "fallback" && completedOpacity >= 0.88;
    if (spatialCoverageChanged(this.spatialVisible, nextVisible)) {
      this.spatialVisible = nextVisible;
      // Visibility changes require switching the fallback renderer. Repeated
      // identical callbacks were redundantly aborting fallback timers while
      // a large OM field was being decoded.
      if (nextVisible) this.onLive?.();
      else this.onMiss?.();
    }
  }

  /** Dispose all Leaflet image layers, timers and closures on map teardown.
   * React StrictMode can re-attach the same instance after effect cleanup.
   */
  dispose() {
    this.metadataAbort?.abort();
    this.metadataAbort = null;
    if (this.map && this.updateBoundsListener) this.map.off("moveend", this.updateBoundsListener);
    if (this.map && this.moveStartListener) this.map.off("movestart", this.moveStartListener);
    if (this.map && this.moveEndListener) this.map.off("moveend", this.moveEndListener);
    if (this.map && this.moveListener) this.map.off("move", this.moveListener);
    this.updateBoundsListener = null;
    this.moveStartListener = null;
    this.moveEndListener = null;
    this.moveListener = null;
    this.viewportMoving = false;
    this.viewportHoldUntil = 0;
    this.visible = false;
    this.playbackActive = false;
    this.seq += 1; // invalidate asynchronous frame and metadata callbacks
    this.onLive = null;
    this.onMiss = null;
    this.clear();
    this.viewportRenderer?.dispose();
    this.viewportRenderer = null;
    this.failedUntil.clear();
    this.spatialVisible = false;
    this.lastDisplayedStep = null;
    this.holdingPreviousFrame = false;
    this.fallbackForMissingHour = false;
    this.spatialBudget = { allow: true, reason: "regional", rasterSize: 1024 };
    this.protocolSettings = null;
    this.times = [];
    this.pinnedRun = null;
    this.adapter = null;
    this.map = null;
  }

  private clear() {
    for (const step of [...this.frames.keys()]) this.discardFrame(step);
    for (const timer of this.pendingTimers.values()) window.clearTimeout(timer);
    this.pendingTimers.clear();
    this.loading.clear();
  }
}

import type { Map as LeafletMap } from "leaflet";
import { modelTileFrameReady, isPrecipitationTile } from "@/weather/modelTileReadiness";
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

async function pluginSpatial(url: string, init: RequestInit | undefined, headers: Headers): Promise<Response> {
  const bag: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (headerName(key)) bag[key] = value;
  });
  bag["Accept-Encoding"] = "identity";
  const method = (init?.method ?? "GET").toUpperCase();
  const result = await CapacitorHttp.request({
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
    const total = await probeLength(url, headers);
    if (total) out.set("content-length", total);
  }
  const expect = rangeLength(headers);
  if (expect != null && bytes.byteLength !== expect) {
    throw new Error(`range ${bytes.byteLength}!=${expect}`);
  }
  if ((result.status || 0) >= 400 || result.status === 0) throw new Error(`spatial ${result.status}`);
  return responseFrom(result.status || 200, out, bytes);
}

async function probeLength(url: string, headers: Headers): Promise<string | null> {
  const bag: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (headerName(key) && key.toLowerCase() !== "range") bag[key] = value;
  });
  bag.Range = "bytes=0-0";
  bag["Accept-Encoding"] = "identity";
  const result = await CapacitorHttp.request({
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
    if (total) return total;
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
    if (native) {
      try {
        return await pluginSpatial(url, { ...init, method }, headers);
      } catch {
        /* الطلب الأصلي للمتصفح إن رفضت الإضافة الطول */
      }
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12000);
    const onAbort = () => ctrl.abort();
    init?.signal?.addEventListener("abort", onAbort);
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
      init?.signal?.removeEventListener("abort", onAbort);
    }
    throw new Error("spatial-fetch");
  };
}
/** Read a canvas tile once to detect meaningful weather data.
 * Do not rewrite the tile's edge pixels: that produces visible grid lines. */
function tileHasInk(tile?: HTMLElement): boolean {
  if (!(tile instanceof HTMLCanvasElement) || tile.width < 2 || tile.height < 2) return false;
  const ctx = tile.getContext("2d");
  if (!ctx) return false;
  try {
    const { width, height } = tile;
    const data = ctx.getImageData(0, 0, width, height).data;
    // Small but real precipitation or snow cells must not be missed.
    const step = 8;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) > 8) return true;
      }
    }
  } catch {
    // A cancelled canvas decode is not ready to display.
  }
  return false;
}

function tileUrl(variable: string, index: number): string {
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
  private base = 0;
  private blend = 0;
  private failed = new Set<number>();
  private loading = new Set<number>();
  private frames = new Map<number, { layers: AnyLayer[]; ink: boolean; token: number; opacity: number; ready: boolean; loaded: boolean[]; errored: Set<number> }>();
  private seq = 0;
  private orderKey = "";
  private visible = false;
  private lastSyncAt = 0;
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
    this.adapter.addProtocol("om", omProtocol, modelSettings());
    this.ready = fetch(META)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { valid_times?: string[] }) => {
        this.times = (json.valid_times ?? []).map((t) => Date.parse(t)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
      })
      .catch(() => {
        this.times = [];
      });
  }

  whenReady(): Promise<number> {
    return this.ready.then(() => this.times.length);
  }

  setVisible(on: boolean) {
    this.visible = on;
    if (!on) {
      this.seq += 1;
      this.failed.clear();
      this.loading.clear();
      this.orderKey = "";
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
    const i = this.base;
    this.dropFar(i);
    for (const step of [i, i + 1]) {
      if (step < 0 || step >= this.times.length) continue;
      if (this.failed.has(step) || this.frames.has(step) || this.loading.has(step)) continue;
      this.mount(step);
    }
  }

  private dropFar(i: number) {
    const keep = new Set([i, i + 1]);
    for (const [step, frame] of this.frames) {
      if (keep.has(step) || this.loading.has(step)) continue;
      // ساعة ابتعدت عن المؤشر تُترك حتى تخفت، فلا تختفي الكتلة قفزاً.
      if (frame.ink && frame.opacity > 0.04) continue;
      frame.layers.forEach((layer) => layer.remove());
      this.frames.delete(step);
    }
  }

  private newestInk(): number {
    let best = -1;
    for (const [step, frame] of this.frames) if (frame.ready && step > best) best = step;
    return best;
  }

  private anyInk(): boolean {
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
    // The ECMWF cloud-cover tile layer can produce large rectangular, opaque
    // cloud sheets at tile boundaries on Android. The continuous global
    // model-backed cloud field already paints cloud cover below these tiles.
    // Reserve spatial tiles for precipitation and snowfall, where the local
    // high-resolution data is materially useful and has separate palettes.
    const rainOpts = { pane: "wx-model", opacity: 0, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 2 };
    const made = [
      adapter.createTileLayer(tileUrl("precipitation", step), rainOpts),
      adapter.createTileLayer(tileUrl("snowfall_water_equivalent", step), rainOpts),
    ] as AnyLayer[];
    const frame = { layers: made, ink: false, token, opacity: -1, ready: false, loaded: Array<boolean>(made.length).fill(false), errored: new Set<number>() };
    this.frames.set(step, frame);
    if (!this.anyInk()) this.onMiss?.();
    let errors = 0;
    const alive = () => this.frames.get(step)?.token === token;
    const refresh = () => {
      if (!alive()) return;
      const ready = modelTileFrameReady(frame.ink, frame.loaded, frame.errored);
      if (ready === frame.ready) return;
      frame.ready = ready;
      this.orderKey = "";
      if (!ready) {
        // Partial frames are never exposed: keep the global rain/snow canvas visible.
        frame.opacity = 0;
        for (const layer of made) layer.setOpacity?.(0);
      }
      this.applyOpacity();
    };
    const giveUp = () => {
      if (!alive() || frame.ink) return;
      this.failed.add(step);
      this.loading.delete(step);
      for (const layer of made) layer.remove();
      if (this.frames.get(step) === frame) this.frames.delete(step);
      if (!this.anyInk()) this.onMiss?.();
      this.pump();
    };
    const wait = window.setTimeout(() => {
      if (!alive() || frame.ink) return;
      giveUp();
    }, 20000);
    for (const [index, layer] of made.entries()) {
      // 'tileload' reports ONE tile. 'load' reports that the complete current
      // viewport tile queue has settled. Only the latter may replace fallback.
      layer.on("loading", () => {
        if (!alive()) return;
        frame.loaded[index] = false;
        frame.errored.delete(index);
        refresh();
      });
      layer.on("load", () => {
        if (!alive()) return;
        frame.loaded[index] = true;
        refresh();
      });
      layer.on("tileload", (ev) => {
        // Canvas readback is expensive on Android; only inspect until the first nonempty tile.
        // Only rain/snow tiles are mounted; both must finish loading.
        if (!alive() || frame.ink || !isPrecipitationTile(index) || !tileHasInk(ev?.tile)) return;
        frame.ink = true;
        this.loading.delete(step);
        window.clearTimeout(wait);
        refresh();
        this.pump();
      });
      layer.on("tileerror", () => {
        if (!alive()) return;
        frame.errored.add(index);
        refresh();
        if (frame.ink) return;
        errors += 1;
        if (errors >= 8) {
          window.clearTimeout(wait);
          giveUp();
        }
      });
      layer.addTo(map);
    }
  }

  /** الساعة الأقدم تخفت بينما الساعة الأحدث تظهر، فتنساب الكتل بدل القفزة. */
  private applyOpacity() {
    const i = this.base;
    const next = this.blend;
    const ink = (step: number) => this.frames.get(step)?.ready === true;
    const both = ink(i) && ink(i + 1);
    const held = !both && !ink(i) && !ink(i + 1) ? this.newestInk() : -1;
    const key = `${i}:${held}:${both ? "ab" : ink(i) ? "a" : ink(i + 1) ? "b" : ""}`;
    if (key !== this.orderKey) {
      this.orderKey = key;
      for (const step of [i, i + 1]) {
        const frame = this.frames.get(step);
        if (!frame?.ink) continue;
        for (const layer of frame.layers) layer.bringToFront?.();
      }
    }
    const goalFor = (step: number): number => {
      if (!ink(step)) return 0;
      if (both) {
        if (step === i) return 1 - next;
        if (step === i + 1) return next;
        return 0;
      }
      if (ink(i) && step === i) return 1;
      if (!ink(i) && ink(i + 1) && step === i + 1) return 1;
      if (step === held) return 1;
      return 0;
    };
    for (const [step, frame] of this.frames) {
      if (!frame.ink) continue;
      const goal = goalFor(step);
      const cur = frame.opacity < 0 ? 0 : frame.opacity;
      const shown = cur + (goal - cur) * 0.28;
      const value = Math.abs(goal - shown) < 0.02 ? goal : shown;
      if (Math.abs(frame.opacity - value) < 0.01) continue;
      frame.opacity = value;
      for (const layer of frame.layers) layer.setOpacity?.(value);
    }
    // Reveal the model only after sufficient tile opacity is actually present,
    // avoiding the abrupt disappearance of visible rain/snow during blending.
    const visibleOpacity = Array.from(this.frames.values()).reduce(
      (sum, frame) => sum + (frame.ready ? Math.max(0, frame.opacity) : 0),
      0,
    );
    if (visibleOpacity >= 0.88) this.onLive?.();
    else this.onMiss?.();
  }

  private clear() {
    for (const frame of this.frames.values()) frame.layers.forEach((layer) => layer.remove());
    this.frames.clear();
    this.loading.clear();
  }
}

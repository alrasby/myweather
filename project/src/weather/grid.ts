import { readGrid, saveGrid } from "./gridCache";
import type { FieldSample, GridField } from "@/weather/types";
import { dirFromUV } from "@/weather/heading";
import { proxyFetch } from "@/weather/net";

/**
 * جلب الشبكات من Open-Meteo.
 * قاعدة المطر: قيمة الساعة نفسها فقط — ممنوع جمع ٣ ساعات.
 * التوازي ٦، و٨٠ نقطة لكل طلب. الشبكة العالمية تُجلب مرة وتُرسم على كامل الشاشة.
 */

export type GridRequest = {
  south: number;
  north: number;
  west: number;
  lonSpan: number;
  cols: number;
  rows: number;
  hours: number;
  full: boolean;
  /** لا تنشر المطر إلى الخلايا الناقصة. الحرارة والرياح تبقى كما هي. */
  dryRain?: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

type Cell = {
  temp: number;
  rain: number;
  u: number;
  v: number;
  spd: number;
  msl: number;
  cloud: number;
  snow: number;
  snowDepth: number;
  ok: boolean;
};

let quotaUntil = 0;

export function isQuotaBlocked(): boolean {
  return Date.now() < quotaUntil;
}

export function markQuota(ms = 20 * 60_000): void {
  quotaUntil = Date.now() + Math.max(15_000, ms);
}

export function resetQuota(): void {
  quotaUntil = 0;
}
const lru = new Map<string, GridField>();
const inflight = new Map<string, Promise<GridField>>();
const inflightSignals = new Map<string, AbortSignal | undefined>();
const LRU_MAX = 8;

function touch<T>(map: Map<string, T>, key: string, value: T) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > LRU_MAX) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

export function normDelta(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

export function normLon(lon: number): number {
  const n = normDelta(lon);
  return n === -180 ? -180 : n;
}

export function mercY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  const r = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

/** مركاتور زاوية الشاشة كما هي، حتى لا تتمدد الطبقة فوق فراغ خارج العالم. */
export function mercYView(lat: number): number {
  const clamped = Math.max(-89.2, Math.min(89.2, lat));
  const r = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

export function mercToLat(m: number): number {
  return (Math.atan(Math.sinh(m)) * 180) / Math.PI;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function gridKey(req: GridRequest): string {
  return [
    req.full ? "F" : "D",
    round1(req.south),
    round1(req.north),
    round1(req.west),
    round1(req.lonSpan),
    req.cols,
    req.rows,
    req.hours,
    req.dryRain ? "dry" : "wet",
    "a46",
    Math.floor(Date.now() / (30 * 60_000)),
  ].join("|");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchRetry(url: string, signal?: AbortSignal): Promise<Response> {
  if (isQuotaBlocked()) throw new Error("quota");
  let lastStatus = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await proxyFetch(url, signal, "background");
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        throw new Error(`reject ${res.status}`);
      }
      if (res.ok) return res;
      lastStatus = res.status;
      if (res.status === 429) {
        const text = await res.text().catch(() => "");
        if (/daily (api )?request limit|daily limit exceeded/i.test(text)) {
          markQuota(30 * 60_000);
          throw new Error("quota");
        }
      } else if (res.status < 500) {
        throw new Error(`http ${res.status}`);
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message === "quota") { markQuota(60_000); throw err; }
      if (message.startsWith("reject") || message === "quota" || message.startsWith("http ")) throw err;
      lastErr = err;
    }
    if (attempt === 0) await sleep(280, signal);
  }
  if (lastErr instanceof Error && !lastStatus) throw lastErr;
  throw new Error(lastStatus === 429 ? "quota" : `http ${lastStatus || "fail"}`);
}

type HourlyBlock = {
  time?: string[];
  temperature_2m?: (number | null)[];
  precipitation?: (number | null)[];
  rain?: (number | null)[];
  showers?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  wind_u_component_10m?: (number | null)[];
  wind_v_component_10m?: (number | null)[];
  pressure_msl?: (number | null)[];
  cloud_cover?: (number | null)[];
  cloud_cover_low?: (number | null)[];
  cloud_cover_mid?: (number | null)[];
  precipitation_probability?: (number | null)[];
  snowfall?: (number | null)[];
  snow_depth?: (number | null)[];
};

type PointResponse = {
  latitude?: number;
  longitude?: number;
  hourly?: HourlyBlock;
  utc_offset_seconds?: number;
};

function asArray(json: unknown): PointResponse[] {
  if (Array.isArray(json)) return json as PointResponse[];
  if (json && typeof json === "object") return [json as PointResponse];
  return [];
}

function parseGmt(iso: string): number {
  if (!iso) return NaN;
  if (iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso)) return Date.parse(iso);
  return Date.parse(`${iso}Z`);
}

function vec(spd: number, dir: number, u: number | null | undefined, v: number | null | undefined) {
  if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) {
    const mag = Math.hypot(u, v);
    const s = Number.isFinite(spd) ? spd : mag;
    if (mag > 0.15 && s > 0.15) {
      const ratio = s / mag;
      if (ratio > 2.4 && ratio < 5) return { u: u * ratio, v: v * ratio, spd: s };
    }
    return { u, v, spd: s };
  }
  const s = Number.isFinite(spd) ? spd : 0;
  const rad = ((Number.isFinite(dir) ? dir : 0) * Math.PI) / 180;
  return { u: -s * Math.sin(rad), v: -s * Math.cos(rad), spd: s };
}

function buildUrl(lats: number[], lons: number[], hours: number): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lats.join(","));
  url.searchParams.set("longitude", lons.join(","));
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation,rain,showers,snowfall,snow_depth,cloud_cover,wind_speed_10m,wind_direction_10m,pressure_msl",
  );
  url.searchParams.set("timezone", "GMT");
  url.searchParams.set("cell_selection", "nearest");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("forecast_hours", String(hours));
  url.searchParams.set("forecast_days", String(Math.min(16, Math.ceil(hours / 24) + 1)));
  return url.toString();
}

async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
) {
  let cursor = 0;
  const run = async () => {
    for (;;) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i]!);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
}

type Point = { i: number; lat: number; lon: number };

function makePoints(req: GridRequest): Point[] {
  const mS = mercY(req.south);
  const mN = mercY(req.north);
  const points: Point[] = [];
  for (let r = 0; r < req.rows; r++) {
    const merc = mS + ((r + 0.5) * (mN - mS)) / req.rows;
    const lat = mercToLat(merc);
    for (let c = 0; c < req.cols; c++) {
      const lonRaw = req.west + ((c + 0.5) * req.lonSpan) / req.cols;
      const lon = Math.max(-179.99, Math.min(179.99, normLon(lonRaw)));
      points.push({ i: r * req.cols + c, lat, lon });
    }
  }
  return points;
}

function emptyCells(n: number, hours: number): Cell[][] {
  return Array.from({ length: n }, () =>
    Array.from({ length: hours }, () => ({
      temp: 0,
      rain: 0,
      u: 0,
      v: 0,
      spd: 0,
      msl: 1013,
      cloud: 0,
      snow: 0,
      snowDepth: 0,
      ok: false,
    })),
  );
}

function finiteOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** غيوم ماطرة: غطاء منخفض/متوسط، أو سماء مكتظة، أو احتمال مطر قريب. */
function rainDeck(h: HourlyBlock, t: number, rain: number): number {
  // Cloud cover is independent of precipitation; do not fabricate clouds from probability.
  return Math.max(0, Math.min(100, finiteOrNull(h.cloud_cover?.[t]) ?? 0));
}

function applyBlock(cells: Cell[][], index: number, block: PointResponse | undefined, hours: number) {
  const h = block?.hourly;
  if (!h?.time?.length) return;
  const n = Math.min(hours, h.time.length);
  for (let t = 0; t < n; t++) {
    const temp = h.temperature_2m?.[t];
    const spdRaw = h.wind_speed_10m?.[t];
    const dir = h.wind_direction_10m?.[t];
    if (temp == null || !Number.isFinite(temp)) continue;
    const rainRaw = h.precipitation?.[t];
    const liquid = finiteOrNull(h.rain?.[t]);
    const showers = finiteOrNull(h.showers?.[t]);
    const snowEquivalent = Math.max(0, h.snowfall?.[t] ?? 0) / 0.7;
    const rain = liquid != null && showers != null ? Math.max(0, liquid + showers)
      : Math.max(0, (rainRaw ?? 0) - snowEquivalent);
    const snowRaw = h.snowfall?.[t];
    const snow = snowRaw == null || !Number.isFinite(snowRaw) ? 0 : Math.max(0, snowRaw);
    const depthRaw = h.snow_depth?.[t];
    const snowDepth = depthRaw == null || !Number.isFinite(depthRaw) ? 0 : Math.max(0, depthRaw);
    const mslRaw = h.pressure_msl?.[t];
    const msl = mslRaw != null && Number.isFinite(mslRaw) ? mslRaw : 1013;
    const { u, v, spd } = vec(spdRaw ?? 0, dir ?? 0, h.wind_u_component_10m?.[t], h.wind_v_component_10m?.[t]);
    cells[index]![t] = { temp, rain, u, v, spd, msl, cloud: rainDeck(h, t, rain), snow, snowDepth, ok: true };
  }
}

async function fetchBatch(points: Point[], hours: number, signal?: AbortSignal): Promise<PointResponse[]> {
  const url = buildUrl(
    points.map((p) => Number(p.lat.toFixed(4))),
    points.map((p) => Number(p.lon.toFixed(4))),
    hours,
  );
  const res = await fetchRetry(url, signal);
  return asArray(await res.json());
}

function fillRatio(cells: Cell[][]): number {
  if (!cells.length) return 0;
  let ok = 0;
  for (const col of cells) if (col[0]?.ok) ok++;
  return ok / cells.length;
}

function pack(req: GridRequest, cells: Cell[][], times: number[], id: string): GridField {
  const { cols, rows, hours } = req;
  const n = hours * rows * cols;
  const temp = new Float32Array(n);
  const rain = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const spd = new Float32Array(n);
  const msl = new Float32Array(n);
  const cloud = new Float32Array(n);
  const snow = new Float32Array(n);
  const snowDepth = new Float32Array(n);
  msl.fill(1013);
  const ok = new Uint8Array(n);
  for (let h = 0; h < hours; h++) {
    for (let i = 0; i < cols * rows; i++) {
      const cell = cells[i]?.[h];
      const o = h * rows * cols + i;
      if (!cell?.ok) continue;
      temp[o] = cell.temp;
      rain[o] = cell.rain;
      u[o] = cell.u;
      v[o] = cell.v;
      spd[o] = cell.spd;
      msl[o] = cell.msl;
      cloud[o] = cell.cloud;
      snow[o] = cell.snow;
      snowDepth[o] = cell.snowDepth;
      ok[o] = 1;
    }
  }
  const grid: GridField = {
    id,
    cols,
    rows,
    hours,
    south: req.south,
    north: req.north,
    west: req.west,
    lonSpan: req.lonSpan,
    full: req.full,
    times,
    temp,
    rain,
    u,
    v,
    spd,
    msl,
    cloud,
    snow,
    snowDepth,
    ok,
  };
  // Missing model cells remain transparent; never spread neighbouring precipitation into them.
  return grid;
}

const BATCH = 80;

function assignBlocks(cells: Cell[][], batch: Point[], json: PointResponse[], hours: number, times: { list: number[] }) {
  const used = new Set<number>();
  json.forEach((block, idx) => {
    // Multi-location responses preserve request order, including locations snapped to the same model cell.
    if (json.length === batch.length) {
      if (!times.list.length && block.hourly?.time?.length) times.list = block.hourly.time.slice(0, hours).map(parseGmt);
      applyBlock(cells, batch[idx]!.i, block, hours);
      return;
    }
    const lat = block?.latitude;
    const lon = block?.longitude;
    let point: Point | undefined;
    if (typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)) {
      let best = 2.2;
      for (const p of batch) {
        if (used.has(p.i)) continue;
        const d = Math.hypot(p.lat - lat, normDelta(p.lon - lon));
        if (d < best) {
          best = d;
          point = p;
        }
      }
    } else {
      const fallback = batch[idx];
      if (fallback && !used.has(fallback.i)) point = fallback;
    }
    if (!point) return;
    used.add(point.i);
    if (!times.list.length && block?.hourly?.time?.length) {
      times.list = block.hourly.time.slice(0, hours).map(parseGmt);
    }
    applyBlock(cells, point.i, block, hours);
  });
}

async function fetchGridUncached(req: GridRequest, key: string): Promise<GridField> {
  const points = makePoints(req);
  const cells = emptyCells(points.length, req.hours);
  const batches: Point[][] = [];
  for (let i = 0; i < points.length; i += BATCH) batches.push(points.slice(i, i + BATCH));
  let done = 0;
  const times = { list: [] as number[] };

  const consume = async (batch: Point[], count: boolean) => {
    try {
      const json = await fetchBatch(batch, req.hours, req.signal);
      assignBlocks(cells, batch, json, req.hours, times);
    } catch (err) {
      if (req.signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message === "quota") { markQuota(60_000); throw err; }
      if (message.startsWith("reject") && batch.length > 8) {
        const mid = Math.floor(batch.length / 2);
        await consume(batch.slice(0, mid), false);
        await consume(batch.slice(mid), false);
        return;
      }
    } finally {
      if (count) {
        done++;
        req.onProgress?.(done, batches.length);
      }
    }
  };

  await pool(batches, 3, (batch) => consume(batch, true), req.signal);

  const missing = points.filter((p) => !cells[p.i]?.[0]?.ok);
  if (missing.length && missing.length < points.length) {
    const again: Point[][] = [];
    for (let i = 0; i < missing.length; i += 40) again.push(missing.slice(i, i + 40));
    await pool(again, 3, (batch) => consume(batch, false), req.signal);
  }

  if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
  const ratio = fillRatio(cells);
  if (req.full ? ratio < 0.35 : ratio < 0.28) throw new Error("thin");
  if (!times.list.length || times.list.some((t) => !Number.isFinite(t))) {
    const start = Date.now();
    times.list = Array.from({ length: req.hours }, (_, i) => start + i * 3_600_000);
  }
  while (times.list.length < req.hours) {
    const prev = times.list[times.list.length - 1] ?? Date.now();
    times.list.push(prev + 3_600_000);
  }
  const grid = pack(req, cells, times.list.slice(0, req.hours), key);

  return grid;
}

export function fetchGrid(req: GridRequest): Promise<GridField> {
  const key = gridKey(req);
  const hit = lru.get(key);
  if (hit) {
    touch(lru, key, hit);
    return Promise.resolve(hit);
  }
  const pending = inflight.get(key);
  if (pending && !inflightSignals.get(key)?.aborted) return pending;
  const promise = readGrid(key).then(cached => {
    if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return cached ?? fetchGridUncached(req, key);
  })
    .then((grid) => {
      if (!req.signal?.aborted) { touch(lru, key, grid); void saveGrid(grid); }
      return grid;
    })
    .finally(() => {
      if (inflight.get(key) === promise) { inflight.delete(key); inflightSignals.delete(key); }
    });
  inflight.set(key, promise);
  inflightSignals.set(key, req.signal);
  return promise;
}

export function clearGridCache() {
  lru.clear();
}

export type ViewBox = { south: number; north: number; west: number; east: number };

export function covers(grid: GridField, view: ViewBox): boolean {
  let west = view.west;
  let east = view.east;
  if (east < west) east += 360;
  const span = Math.min(360, east - west);
  if (view.south < grid.south - 0.4 || view.north > grid.north + 0.4) return false;
  if (!grid.full && span > grid.lonSpan + 0.4) return false;
  if (grid.full) return true;
  const eastLon = east > 180 ? east - 360 : east;
  return lonInside(grid, west) && lonInside(grid, eastLon);
}

function lonInside(grid: GridField, lon: number): boolean {
  const d = normDelta(lon - grid.west);
  return d >= -0.05 && d <= grid.lonSpan + 0.05;
}

function cellIndex(grid: GridField, hour: number, row: number, col: number): number {
  const cc = grid.full ? ((col % grid.cols) + grid.cols) % grid.cols : col;
  return (hour * grid.rows + row) * grid.cols + cc;
}

function sampleScalar(
  grid: GridField,
  arr: Float32Array,
  lat: number,
  lon: number,
  hour: number,
): number | null {
  if (!grid.full && (lat < grid.south - 0.05 || lat > grid.north + 0.05)) return null;
  const d = normDelta(lon - grid.west);
  if (!grid.full && (d < -0.05 || d > grid.lonSpan + 0.05)) return null;
  const u = grid.full ? ((d % grid.lonSpan) + grid.lonSpan) % grid.lonSpan : d;
  const gx = (u / grid.lonSpan) * grid.cols - 0.5;
  const m = mercY(lat);
  const mS = mercY(grid.south);
  const mN = mercY(grid.north);
  const gy = ((m - mS) / (mN - mS || 1)) * grid.rows - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  let acc = 0;
  let wsum = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const c = x0 + dx;
      const r = y0 + dy;
      if (!grid.full && (c < 0 || c >= grid.cols)) continue;
      if (r < 0 || r >= grid.rows) continue;
      const i = cellIndex(grid, hour, r, c);
      if (!grid.ok[i]) continue;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      acc += arr[i]! * w;
      wsum += w;
    }
  }
  if (wsum <= 0) return null;
  return acc / wsum;
}

export function hourBlend(times: number[], hourMs: number): { h0: number; h1: number; t: number } {
  if (!times.length) return { h0: 0, h1: 0, t: 0 };
  if (hourMs <= times[0]!) return { h0: 0, h1: 0, t: 0 };
  const last = times.length - 1;
  if (hourMs >= times[last]!) return { h0: last, h1: last, t: 0 };
  let i = 0;
  while (i < last && times[i + 1]! < hourMs) i++;
  const t0 = times[i]!;
  const t1 = times[Math.min(last, i + 1)]!;
  const t = t1 === t0 ? 0 : (hourMs - t0) / (t1 - t0);
  return { h0: i, h1: Math.min(last, i + 1), t };
}

export function blendIndex(hours: number, index: number): { h0: number; h1: number; t: number } {
  if (hours <= 1) return { h0: 0, h1: 0, t: 0 };
  const max = hours - 1;
  const clamped = Math.max(0, Math.min(max, index));
  const h0 = Math.floor(clamped);
  const h1 = Math.min(max, h0 + 1);
  return { h0, h1, t: clamped - h0 };
}

function mix(a: number | null, b: number | null, t: number): number | null {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * t;
}

function nearestScalar(
  grid: GridField,
  arr: Float32Array,
  lat: number,
  lon: number,
  hour: number,
): number | null {
  if (!grid.full && (lat < grid.south - 0.05 || lat > grid.north + 0.05)) return null;
  const d = normDelta(lon - grid.west);
  if (!grid.full && (d < -0.05 || d > grid.lonSpan + 0.05)) return null;
  const u = grid.full ? ((d % grid.lonSpan) + grid.lonSpan) % grid.lonSpan : d;
  const gx = (u / grid.lonSpan) * grid.cols - 0.5;
  const m = mercY(lat);
  const mS = mercY(grid.south);
  const mN = mercY(grid.north);
  const gy = ((m - mS) / (mN - mS || 1)) * grid.rows - 0.5;
  let c = Math.round(gx);
  let r = Math.round(gy);
  if (grid.full) c = ((c % grid.cols) + grid.cols) % grid.cols;
  else if (c < 0 || c >= grid.cols) return null;
  if (r < 0 || r >= grid.rows) return null;
  const i = cellIndex(grid, hour, r, c);
  if (!grid.ok[i]) return null;
  return arr[i] ?? 0;
}

/** مطر خلية القياس نفسها، بلا تلطيخ على الجيران. */
export function sampleNearestRain(grid: GridField, lat: number, lon: number, hourIndex: number): number {
  const { h0, h1, t } = blendIndex(grid.hours, hourIndex);
  const a = nearestScalar(grid, grid.rain, lat, lon, h0);
  const b = nearestScalar(grid, grid.rain, lat, lon, h1);
  if (a == null && b == null) return 0;
  if (a == null) return b ?? 0;
  if (b == null) return a;
  return a + (b - a) * t;
}

export function sampleGrid(grid: GridField, lat: number, lon: number, hourIndex: number): FieldSample | null {
  const { h0, h1, t } = blendIndex(grid.hours, hourIndex);
  const temp = mix(sampleScalar(grid, grid.temp, lat, lon, h0), sampleScalar(grid, grid.temp, lat, lon, h1), t);
  const rain = mix(sampleScalar(grid, grid.rain, lat, lon, h0), sampleScalar(grid, grid.rain, lat, lon, h1), t);
  const spd = mix(sampleScalar(grid, grid.spd, lat, lon, h0), sampleScalar(grid, grid.spd, lat, lon, h1), t);
  const u = mix(sampleScalar(grid, grid.u, lat, lon, h0), sampleScalar(grid, grid.u, lat, lon, h1), t);
  const v = mix(sampleScalar(grid, grid.v, lat, lon, h0), sampleScalar(grid, grid.v, lat, lon, h1), t);
  const cloud = grid.cloud
    ? mix(sampleScalar(grid, grid.cloud, lat, lon, h0), sampleScalar(grid, grid.cloud, lat, lon, h1), t)
    : 0;
  const snow = grid.snow
    ? mix(sampleScalar(grid, grid.snow, lat, lon, h0), sampleScalar(grid, grid.snow, lat, lon, h1), t)
    : 0;
  const snowDepth = grid.snowDepth
    ? mix(sampleScalar(grid, grid.snowDepth, lat, lon, h0), sampleScalar(grid, grid.snowDepth, lat, lon, h1), t)
    : 0;
  if (temp == null || spd == null || u == null || v == null) return null;
  const dirs = dirFromUV(u, v);
  return {
    temp,
    rain: rain ?? 0,
    spd,
    u,
    v,
    dirFrom: dirs.from,
    dirTo: dirs.to,
    cloud: cloud ?? 0,
    snow: snow ?? 0,
    snowDepth: snowDepth ?? 0,
  };
}

export function indexToMs(times: number[], index: number): number {
  if (!times.length) return Date.now();
  const { h0, h1, t } = blendIndex(times.length, index);
  return times[h0]! + (times[h1]! - times[h0]!) * t;
}

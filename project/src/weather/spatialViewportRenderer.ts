/** Bounded, reversible ECMWF raster backend for non-isolated Android WebView.
 *
 * Open-Meteo still performs all .om range reads and variable derivations.
 * We request an arrayBuffer/empty vector through upstream for EVERY requested
 * viewport before selecting its decoded state. This is a cheap no-raster
 * operation after the first read, but critically verifies that the data
 * covers the latest map bounds (an older shortcut reused an obsolete state).
 * Its decoded state is copied once to a persistent viewport worker and
 * reused across several tiles.
 * A worker or memory failure fails over to the official OM raster renderer.
 *
 * No dependency patches, alternative weather providers or fabricated pixels.
 */
import { getProtocolInstance, omProtocol } from "@openmeteo/weather-map-layer";
import { SpatialAdmissionError, SpatialRenderAdmission } from "./spatialRenderAdmission.ts";
import type { OmProtocolSettings, OmUrlState, RenderableColorScale } from "@openmeteo/weather-map-layer";

type ReadKey = string;
type RasterTask = { z: number; x: number; y: number; size: number };
export const SPATIAL_WORKER_VARIABLES = ["cloud_cover", "precipitation", "snowfall_water_equivalent"] as const;
type SpatialVariable = typeof SPATIAL_WORKER_VARIABLES[number];
// Three resident ECMWF fields, but at most two active raster jobs.
export const MAX_ACTIVE_SPATIAL_WORKERS = 2;
/** Keep model-hour data hot for up to six intervening tiles / 550ms.
 * After that the oldest queued raster wins; no hour can be starved. */
export function nextSpatialWorkerJob(
  jobs: readonly { variable: SpatialVariable; dataKey?: string; queuedAt?: number }[],
  slots: readonly { variable: SpatialVariable; busy: boolean; cache?: ReadonlyMap<string, number> }[],
  nowMs = performance.now(),
): { job: number; slot: number } | null {
  let first: { job: number; slot: number } | null = null;
  for (let i = 0; i < jobs.length; i++) {
    const slot = slots.findIndex(s => !s.busy && s.variable === jobs[i]!.variable);
    if (slot >= 0) { first = { job: i, slot }; break; }
  }
  if (!first) return null;
  const oldest = jobs[first.job]!;
  if (oldest.dataKey && slots[first.slot]?.cache?.has(oldest.dataKey)) return first;
  if (oldest.queuedAt == null || nowMs - oldest.queuedAt >= 550) return first;
  for (let i = first.job + 1; i < Math.min(jobs.length, first.job + 7); i++) {
    const job = jobs[i]!;
    const slot = slots.findIndex(s => !s.busy && s.variable === job.variable &&
      !!job.dataKey && !!s.cache?.has(job.dataKey));
    if (slot >= 0) return { job: i, slot };
  }
  return first;
}
type TileJob = { id: number; state: OmUrlState; dataKey: string; variable: SpatialVariable;
  queuedAt: number; values: Float32Array; palette: Palette;
  tile: RasterTask; signal: AbortSignal; resolve: (value: ImageBitmap) => void;
  reject: (error: Error) => void; started: boolean; onAbort: () => void };
type Palette = { breakpoints: number[]; colors: number[][] };
type Slot = { worker: Worker; variable: SpatialVariable; cache: Map<string, number>; busy: TileJob | null;
  bytes: number; watchdog?: ReturnType<typeof setTimeout> };
type Reply = { type: "rendered"; id: number; bitmap: ImageBitmap; durationMs: number } |
  { type: "error"; id: number; error: string };
export type ViewportFallbackReason = "missingData" | "oversizedData" | "admissionSaturated" |
  "admissionDeadline" | "workerFailure" | "other";
export type ViewportFallbackReasons = Record<ViewportFallbackReason, number>;
export type ViewportRendererStats = {
  mode: "worker-cache" | "legacy";
  workerTiles: number; fallbackTiles: number; datasetCopies: number; datasetReuses: number;
  datasetEvictions: number; workerSlots: number; capturedReadRecoveries: number;
  queued: number; peakWaiting: number; reasons: ViewportFallbackReasons;
  renderP50Ms: number | null; renderP95Ms: number | null;
};
export function classifyViewportFailure(error: unknown): ViewportFallbackReason {
  if (error instanceof SpatialAdmissionError)
    return error.reason === "saturated" ? "admissionSaturated" :
      error.reason === "deadline" ? "admissionDeadline" : "workerFailure";
  if (error instanceof Error && (/worker|viewport-data|model-data-evicted/i).test(error.message))
    return "workerFailure";
  return "other";
}
// ECMWF IFS HRES uses a reduced Gaussian grid of up to 6,599,680
// Float32 values (26,398,720 bytes = 25.18 MiB). The old 24 MiB
// cutoff rejected full-latitude-band data and forced legacy rendering
// on >100 tiles during a single real-device test. 32 MiB covers the
// COMPLETE provider grid with only +8 MiB possible per worker.
export const MAX_WORKER_DATA = 32 * 1024 * 1024;
export const ECMWF_IFS_FULL_GRID_BYTES = 6_599_680 * Float32Array.BYTES_PER_ELEMENT;
const MAX_PENDING_TILES = 40;
const RENDER_DEADLINE_MS = 20000;
const tileSuffix = /\/(\d+)\/(\d+)\/(\d+)$/;

function pctl(input: number[], fraction: number): number | null {
  if (!input.length) return null;
  const sorted = [...input].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]!);
}
export function parseSpatialRasterTile(url: string): { key: ReadKey; file: string;
  variable: string; tile: RasterTask } | null {
  const m = url.match(tileSuffix);
  if (!m) return null;
  const key = url.slice(0, m.index);
  if (!key.startsWith("om://")) return null;
  const queryAt = key.indexOf("?");
  if (queryAt < 0) return null;
  const params = new URLSearchParams(key.slice(queryAt + 1));
  const variable = params.get("variable");
  if (!["cloud_cover", "precipitation", "snowfall_water_equivalent"].includes(variable ?? "")) return null;
  const size = Number(params.get("tile_size") || 512);
  const tile = { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), size };
  if (![tile.z, tile.x, tile.y, tile.size].every(Number.isInteger) ||
    tile.z < 0 || tile.z > 16 || tile.size < 256 || tile.size > 1024) return null;
  return { key, file: key.slice(5, queryAt), variable: variable!, tile };
}
export function shouldUseViewportWorker(native: boolean, isolated: boolean, workerSupported: boolean,
  legacyOverride: boolean): boolean {
  return native && !isolated && workerSupported && !legacyOverride;
}

/** Do not trust any previously cached model variable until upstream has
 * checked the current bounds and (if needed) fetched the NEW viewport.
 * Exported as a pure async seam so stale-state reuse is regression-tested. */
export async function resolveCurrentSpatialState<T>(
  ensureCurrentBounds: () => Promise<unknown>,
  readState: () => T | null,
): Promise<T | null> {
  await ensureCurrentBounds();
  return readState();
}
/** The exact .om read can complete while Leaflet replaces stateByKey with a
 * newer viewport. Prefer the state captured for this specific request, not
 * an unrelated newer state. Reuse upstream's ordinary loaded-state lookup
 * when a concurrent request already owned the read. */
export function chooseLoadedSpatialState(
  captured: OmUrlState | null,
  states: Iterable<OmUrlState>,
  file: string,
  variable: string,
): OmUrlState | null {
  const valid = (s: OmUrlState | null) => !!s &&
    s.omFileUrl === file && s.dataOptions.variable === variable && !!s.data?.values;
  if (valid(captured)) return captured;
  for (const state of Array.from(states).reverse()) if (valid(state)) return state;
  return null;
}
function paletteOf(settings: OmProtocolSettings, variable: string): Palette | null {
  const scale = settings.colorScales[variable] as RenderableColorScale | undefined;
  if (!scale || scale.type !== "breakpoint" || !scale.breakpoints.length ||
      scale.colors.length !== scale.breakpoints.length) return null;
  return { breakpoints: scale.breakpoints, colors: scale.colors };
}

export class SpatialViewportRenderer {
  private slots: Slot[] = [];
  private jobs: TileJob[] = [];
  private serial = 0;
  private stateIds = new WeakMap<OmUrlState, string>();
  private samples: number[] = [];
  private copied = 0;
  private reused = 0;
  private evicted = 0;
  private recovered = 0;
  private completed = 0;
  private fallbackCount = 0;
  private reasons: ViewportFallbackReasons = {
    missingData: 0, oversizedData: 0, admissionSaturated: 0,
    admissionDeadline: 0, workerFailure: 0, other: 0,
  };
  // Two busy workers plus a bounded queue; overflow waits briefly instead
  // of immediately firing a second, legacy raster engine alongside ours.
  private admission = new SpatialRenderAdmission(MAX_PENDING_TILES + 2, 64, 15_000);
  private disabled = false;

  constructor(enable: boolean) {
    if (!enable || typeof Worker === "undefined") return;
    try {
      // Real-device QA: 189 large variable copies for 308 tiles, no worker
      // fallback. Two 32 MiB workers cannot retain all three IFS variables.
      // Retain a separate variable per worker while keeping CPU at two jobs.
      for (const variable of SPATIAL_WORKER_VARIABLES) {
        const worker = new Worker(new URL("./spatialViewportRaster.worker.ts", import.meta.url), { type: "module" });
        const slot: Slot = { worker, variable, cache: new Map(), busy: null, bytes: 0 };
        worker.onmessage = (event: MessageEvent<Reply>) => this.receive(slot, event.data);
        worker.onerror = () => this.disable(new Error("viewport-worker-error"));
        worker.onmessageerror = () => this.disable(new Error("viewport-worker-message"));
        this.slots.push(slot);
      }
    } catch {
      this.disable(new Error("viewport-worker-unavailable"));
    }
  }

  get active(): boolean { return !this.disabled && this.slots.length > 0; }
  snapshot(): ViewportRendererStats {
    return { mode: this.active ? "worker-cache" : "legacy", workerTiles: this.completed,
      fallbackTiles: this.fallbackCount, datasetCopies: this.copied,
      datasetReuses: this.reused, datasetEvictions: this.evicted,
      workerSlots: this.slots.length, capturedReadRecoveries: this.recovered,
      queued: this.jobs.length + this.admission.waiting,
      peakWaiting: this.admission.peakWaiting, reasons: { ...this.reasons },
      renderP50Ms: pctl(this.samples, 0.5), renderP95Ms: pctl(this.samples, 0.95) };
  }
  readonly handler: typeof omProtocol = async (params, abort, settings) => {
    const config = settings ?? undefined;
    if (!this.active || params.type !== "image" || !config) return omProtocol(params, abort, settings);
    const parsed = parseSpatialRasterTile(params.url);
    const palette = parsed && paletteOf(config, parsed.variable);
    if (!parsed || !palette) return omProtocol(params, abort, settings);
    try {
      const state = await this.ensureDataset(parsed, abort, config);
      if (abort.signal.aborted) return { data: new ArrayBuffer(0) };
      if (!state?.data?.values) {
        this.fallback("missingData");
        return omProtocol(params, abort, config);
      }
      if (state.data.values.byteLength > MAX_WORKER_DATA) {
        this.fallback("oversizedData");
        return omProtocol(params, abort, config);
      }
      const bitmap = await this.render(state, palette, parsed.tile, parsed.variable as SpatialVariable, abort.signal);
      if (abort.signal.aborted) { bitmap.close(); return { data: new ArrayBuffer(0) }; }
      return { data: bitmap };
    } catch (error) {
      if (abort.signal.aborted) return { data: new ArrayBuffer(0) };
      this.fallback(classifyViewportFailure(error));
      return omProtocol(params, abort, config);
    }
  };

  private fallback(reason: ViewportFallbackReason): void {
    this.fallbackCount++;
    this.reasons[reason]++;
  }

  private async ensureDataset(parsed: NonNullable<ReturnType<typeof parseSpatialRasterTile>>,
    controller: AbortController, config: OmProtocolSettings): Promise<OmUrlState | null> {
    // Upstream parseRequest() reads updateCurrentBounds(), then
    // getOrCreateState() verifies boundsIncluded() and replaces a stale
    // spatial data window. The earlier custom shortcut checked file/variable
    // ONLY: it could paint old-area NaNs/transparent rectangles after a pan.
    // Calling arrayBuffer with no vectors/contours never paints a redundant
    // raster tile, and upstream ensureData() already deduplicates concurrent
    // .om reads by state + AbortSignal. Do NOT re-implement that cache here.
    let captured: OmUrlState | null = null;
    const previousCallback = config.postReadCallback;
    const recordRead: NonNullable<OmProtocolSettings["postReadCallback"]> = (reader, data, state) => {
      previousCallback?.(reader, data, state);
      if (state.omFileUrl === parsed.file && state.dataOptions.variable === parsed.variable &&
          data.values) {
        // Shallow snapshot only: no additional 25MiB Float32Array copy.
        // The upstream LRU may null state.data after this precise read.
        captured = { ...state, data };
      }
    };
    const requestSettings = { ...config, postReadCallback: recordRead };
    return resolveCurrentSpatialState(
      () => omProtocol(
        { url: `${parsed.key}/${parsed.tile.z}/${parsed.tile.x}/${parsed.tile.y}`, type: "arrayBuffer" },
        controller, requestSettings,
      ),
      () => {
        if (controller.signal.aborted) return null;
        const states = Array.from(getProtocolInstance(config).stateByKey.values());
        const live = chooseLoadedSpatialState(null, states, parsed.file, parsed.variable);
        const resolved = chooseLoadedSpatialState(captured, states, parsed.file, parsed.variable);
        if (captured && resolved === captured && !live) this.recovered++;
        return resolved;
      },
    );
  }

  private async render(state: OmUrlState, palette: Palette, tile: RasterTask,
    variable: SpatialVariable, signal: AbortSignal): Promise<ImageBitmap> {
    if (!this.active || !state.data?.values) throw new Error("worker-disabled");
    // Hold the exact decoded array reference BEFORE the admission await.
    // Upstream can evict state.data during a pan or hour change, but already
    // accepted raster jobs must not lose their input or force a legacy tile.
    const values = state.data.values;
    // A finite admission wait prevents congestion from silently switching
    // 40+ tiles to a different renderer during the same visible viewport.
    // Leaflet's AbortSignal drops obsolete pans while they are waiting.
    const release = await this.admission.acquire(signal);
    try {
      if (!this.active || signal.aborted) throw new DOMException("Aborted", "AbortError");
      let key = this.stateIds.get(state);
      if (!key) { key = "ecmwf-" + (++this.serial); this.stateIds.set(state, key); }
      return await new Promise<ImageBitmap>((resolve, reject) => {
        const job: TileJob = { id: ++this.serial, state, dataKey: key!, variable,
          queuedAt: performance.now(), values, tile, palette, signal,
          resolve, reject, started: false, onAbort: () => {} };
        job.onAbort = () => {
          const index = this.jobs.indexOf(job);
          if (index >= 0) this.jobs.splice(index, 1);
          // Ignore (and close) a bitmap completed after Leaflet has cancelled
          // this tile; never paint stale viewport pixels.
          reject(new DOMException("Aborted", "AbortError"));
          this.pump();
        };
        if (signal.aborted) { job.onAbort(); return; }
        signal.addEventListener("abort", job.onAbort, { once: true });
        this.jobs.push(job);
        this.pump();
      });
    } finally {
      release();
    }
  }
  private pump() {
    if (!this.active) return;
    let activeCount = this.slots.filter(slot => slot.busy !== null).length;
    while (activeCount < MAX_ACTIVE_SPATIAL_WORKERS && this.jobs.length > 0) {
      // Oldest runnable tile wins; no model-variable data is evicted merely
      // because a different layer had a free worker. CPU budget is unchanged.
      const next = nextSpatialWorkerJob(this.jobs,
        this.slots.map(slot => ({ variable: slot.variable, busy: slot.busy !== null,
          cache: slot.cache })));
      if (!next) break;
      const slot = this.slots[next.slot]!;
      const job = this.jobs.splice(next.job, 1)[0]!;
      if (job.signal.aborted) { job.onAbort(); continue; }
      // This is the exact array held when the job was admitted; reading
      // state.data again after waiting would race upstream's LRU eviction.
      const values = job.values;
      try {
        if (!slot.cache.has(job.dataKey)) {
          while (slot.bytes + values.byteLength > MAX_WORKER_DATA && slot.cache.size) {
            const old = slot.cache.keys().next().value!;
            slot.bytes -= slot.cache.get(old)!;
            slot.cache.delete(old);
            slot.worker.postMessage({ type: "evict", key: old });
            this.evicted++;
          }
          slot.worker.postMessage({ type: "register", key: job.dataKey,
            grid: job.state.dataOptions.domain.grid, ranges: job.state.ranges,
            values, scaleFactor: job.state.data?.scaleFactor, palette: job.palette });
          slot.cache.set(job.dataKey, values.byteLength);
          slot.bytes += values.byteLength;
          this.copied++;
        } else {
          const bytes = slot.cache.get(job.dataKey)!;
          slot.cache.delete(job.dataKey);
          slot.cache.set(job.dataKey, bytes);
          this.reused++;
        }
        slot.busy = job;
        activeCount++;
        job.started = true;
        slot.watchdog = setTimeout(() => this.disable(new Error("viewport-worker-timeout")),
          RENDER_DEADLINE_MS);
        slot.worker.postMessage({ type: "render", id: job.id, key: job.dataKey, ...job.tile });
      } catch {
        job.signal.removeEventListener("abort", job.onAbort);
        job.reject(new Error("viewport-worker-send"));
        this.disable(new Error("viewport-worker-send"));
        return;
      }
    }
  }
  private receive(slot: Slot, data: Reply) {
    const job = slot.busy;
    if (data.type === "error" && data.id === -1) { this.disable(new Error(data.error)); return; }
    if (!job || job.id !== data.id) {
      if (data.type === "rendered") data.bitmap.close();
      return;
    }
    slot.busy = null;
    if (slot.watchdog !== undefined) clearTimeout(slot.watchdog);
    slot.watchdog = undefined;
    job.signal.removeEventListener("abort", job.onAbort);
    if (data.type === "error") job.reject(new Error(data.error));
    else if (job.signal.aborted) data.bitmap.close();
    else {
      this.completed++;
      this.samples.push(data.durationMs);
      if (this.samples.length > 90) this.samples.shift();
      job.resolve(data.bitmap);
    }
    this.pump();
  }
  private disable(reason: Error) {
    if (this.disabled) return;
    this.disabled = true;
    this.admission.close();
    for (const slot of this.slots) {
      if (slot.watchdog !== undefined) clearTimeout(slot.watchdog);
      slot.watchdog = undefined;
      if (slot.busy) { slot.busy.signal.removeEventListener("abort", slot.busy.onAbort);
        slot.busy.reject(reason); }
      slot.worker.terminate();
      slot.cache.clear();
    }
    this.slots = [];
    for (const job of this.jobs) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.reject(reason);
    }
    this.jobs = [];
  }
  clear() {
    for (const slot of this.slots) {
      slot.cache.clear();
      slot.bytes = 0;
      slot.worker.postMessage({ type: "clear" });
    }
  }
  dispose() { this.disable(new Error("viewport-renderer-disposed")); }
}

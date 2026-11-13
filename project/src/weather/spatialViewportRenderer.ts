/** Bounded, reversible ECMWF raster backend for non-isolated Android WebView.
 *
 * Open-Meteo still performs all .om range reads and variable derivations.
 * We request an arrayBuffer/empty vector once to load each real variable
 * WITHOUT painting a redundant first raster tile. Its decoded state is
 * copied once to a persistent viewport worker, then used for multiple tiles.
 * A worker or memory failure fails over to the official OM raster renderer.
 *
 * No dependency patches, alternative weather providers or fabricated pixels.
 */
import { getProtocolInstance, omProtocol } from "@openmeteo/weather-map-layer";
import type { OmProtocolSettings, OmUrlState, RenderableColorScale } from "@openmeteo/weather-map-layer";

type ReadKey = string;
type RasterTask = { z: number; x: number; y: number; size: number };
type TileJob = { id: number; state: OmUrlState; dataKey: string; palette: Palette;
  tile: RasterTask; signal: AbortSignal; resolve: (value: ImageBitmap) => void;
  reject: (error: Error) => void; started: boolean; onAbort: () => void };
type Palette = { breakpoints: number[]; colors: number[][] };
type Slot = { worker: Worker; cache: Map<string, number>; busy: TileJob | null; bytes: number };
type Reply = { type: "rendered"; id: number; bitmap: ImageBitmap; durationMs: number } |
  { type: "error"; id: number; error: string };
export type ViewportRendererStats = {
  mode: "worker-cache" | "legacy";
  workerTiles: number; fallbackTiles: number; datasetCopies: number;
  queued: number; renderP50Ms: number | null; renderP95Ms: number | null;
};
const MAX_WORKER_DATA = 24 * 1024 * 1024;
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
  private pendingData = new Map<ReadKey, { promise: Promise<OmUrlState | null>;
    controller: AbortController; subscribers: number; finished: boolean }>();
  private samples: number[] = [];
  private copied = 0;
  private completed = 0;
  private fallbackCount = 0;
  private disabled = false;

  constructor(enable: boolean) {
    if (!enable || typeof Worker === "undefined") return;
    try {
      for (let i = 0; i < 2; i++) {
        const worker = new Worker(new URL("./spatialViewportRaster.worker.ts", import.meta.url), { type: "module" });
        const slot: Slot = { worker, cache: new Map(), busy: null, bytes: 0 };
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
      fallbackTiles: this.fallbackCount, datasetCopies: this.copied, queued: this.jobs.length,
      renderP50Ms: pctl(this.samples, 0.5), renderP95Ms: pctl(this.samples, 0.95) };
  }
  readonly handler: typeof omProtocol = async (params, abort, settings) => {
    const config = settings ?? undefined;
    if (!this.active || params.type !== "image" || !config) return omProtocol(params, abort, settings);
    const parsed = parseSpatialRasterTile(params.url);
    const palette = parsed && paletteOf(config, parsed.variable);
    if (!parsed || !palette) return omProtocol(params, abort, settings);
    try {
      const state = await this.ensureDataset(parsed, abort.signal, config);
      if (abort.signal.aborted) return { data: new ArrayBuffer(0) };
      if (!state?.data?.values || state.data.values.byteLength > MAX_WORKER_DATA) {
        this.fallbackCount++;
        return omProtocol(params, abort, config);
      }
      const bitmap = await this.render(state, palette, parsed.tile, abort.signal);
      if (abort.signal.aborted) { bitmap.close(); return { data: new ArrayBuffer(0) }; }
      return { data: bitmap };
    } catch {
      if (abort.signal.aborted) return { data: new ArrayBuffer(0) };
      this.fallbackCount++;
      return omProtocol(params, abort, config);
    }
  };

  private async ensureDataset(parsed: NonNullable<ReturnType<typeof parseSpatialRasterTile>>,
    signal: AbortSignal, config: OmProtocolSettings): Promise<OmUrlState | null> {
    const locate = () => {
      const states = getProtocolInstance(config).stateByKey;
      for (const state of states.values()) {
        if (state.omFileUrl === parsed.file && state.dataOptions.variable === parsed.variable &&
            state.data?.values) return state;
      }
      return null;
    };
    const loaded = locate();
    if (loaded) return loaded;
    let entry = this.pendingData.get(parsed.key);
    if (!entry) {
      const controller = new AbortController();
      // ArrayBuffer requests with no arrows/contours draw no tile in upstream
      // but still decode the SAME .om variable and cache the decoded state.
      const pending = { controller, subscribers: 0, finished: false,
        promise: Promise.resolve(null as OmUrlState | null) };
      pending.promise = omProtocol(
        { url: `${parsed.key}/${parsed.tile.z}/${parsed.tile.x}/${parsed.tile.y}`, type: "arrayBuffer" },
        controller, config,
      ).then(() => locate()).finally(() => {
        pending.finished = true;
        if (this.pendingData.get(parsed.key) === pending) this.pendingData.delete(parsed.key);
      });
      this.pendingData.set(parsed.key, pending);
      entry = pending;
    }
    entry.subscribers++;
    let rejectAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) rejectAbort();
      else signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try { return await Promise.race([entry.promise, aborted]); }
    finally {
      if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
      entry.subscribers--;
      if (entry.subscribers <= 0 && !entry.finished) entry.controller.abort();
    }
  }

  private render(state: OmUrlState, palette: Palette, tile: RasterTask, signal: AbortSignal): Promise<ImageBitmap> {
    if (!this.active || !state.data?.values) return Promise.reject(new Error("worker-disabled"));
    if (this.jobs.length >= MAX_PENDING_TILES) return Promise.reject(new Error("worker-queue-full"));
    let key = this.stateIds.get(state);
    if (!key) { key = "ecmwf-" + (++this.serial); this.stateIds.set(state, key); }
    return new Promise((resolve, reject) => {
      const job: TileJob = { id: ++this.serial, state, dataKey: key!, tile, palette, signal,
        resolve, reject, started: false, onAbort: () => {} };
      job.onAbort = () => {
        const index = this.jobs.indexOf(job);
        if (index >= 0) this.jobs.splice(index, 1);
        // An in-flight worker may still finish its draw. Ignore/close that
        // bitmap when it returns; do not deliver obsolete viewport pixels.
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) { job.onAbort(); return; }
      signal.addEventListener("abort", job.onAbort, { once: true });
      this.jobs.push(job);
      this.pump();
    });
  }
  private pump() {
    if (!this.active) return;
    for (const slot of this.slots) {
      if (slot.busy || this.jobs.length === 0) continue;
      // Prefer a decoded dataset already resident in this worker.
      let index = this.jobs.findIndex(job => slot.cache.has(job.dataKey));
      if (index < 0) index = 0;
      const job = this.jobs.splice(index, 1)[0]!;
      if (job.signal.aborted) continue;
      const values = job.state.data?.values;
      if (!values) { job.reject(new Error("model-data-evicted")); continue; }
      try {
        if (!slot.cache.has(job.dataKey)) {
          while (slot.bytes + values.byteLength > MAX_WORKER_DATA && slot.cache.size) {
            const old = slot.cache.keys().next().value!;
            slot.bytes -= slot.cache.get(old)!;
            slot.cache.delete(old);
            slot.worker.postMessage({ type: "evict", key: old });
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
        }
        slot.busy = job;
        job.started = true;
        slot.worker.postMessage({ type: "render", id: job.id, key: job.dataKey, ...job.tile });
      } catch {
        job.signal.removeEventListener("abort", job.onAbort);
        job.reject(new Error("viewport-worker-send"));
        this.disable(new Error("viewport-worker-send"));
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
    for (const slot of this.slots) {
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

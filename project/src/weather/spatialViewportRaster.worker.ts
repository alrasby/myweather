/** MyWeather viewport raster worker.
 * Reuses one already decoded ECMWF .om array across multiple raster tiles.
 * The official GridFactory supplies the SAME spatial interpolation as the
 * upstream raster worker; model values, units and colour breakpoints are not
 * modified. This worker never fetches network data. */
import { GridFactory } from "@openmeteo/weather-map-layer";
import type { Domain } from "@openmeteo/weather-map-layer";

type Range = { start: number; end: number };
type Palette = { breakpoints: number[]; colors: number[][] };
type Register = { type: "register"; key: string; grid: Domain["grid"];
  ranges: Range[]; values: Float32Array; scaleFactor?: number; palette: Palette };
type Render = { type: "render"; id: number; key: string; z: number; x: number; y: number; size: number };
type Command = Register | Render | { type: "evict"; key: string } | { type: "clear" };
type Entry = { grid: ReturnType<typeof GridFactory.create>; values: Float32Array;
  quantum: number; palette: Palette };

const entries = new Map<string, Entry>();
const port = self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<Command>) => void) | null };

function lonAt(x: number, z: number): number {
  return (((x / 2 ** z) * 360 + 360) % 360) - 180;
}
function latAt(y: number, z: number): number {
  const n = Math.PI - 2 * Math.PI * y / 2 ** z;
  return Math.atan(Math.sinh(n)) * (180 / Math.PI);
}
function paint(task: Render, entry: Entry): ImageBitmap {
  const { size, z, x, y } = task;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const lons = new Float64Array(size);
  for (let col = 0; col < size; col++) lons[col] = lonAt(x + (col + 0.5) / size, z);
  const { breakpoints, colors } = entry.palette;
  for (let row = 0; row < size; row++) {
    const lat = latAt(y + (row + 0.5) / size, z);
    for (let col = 0; col < size; col++) {
      const value = entry.grid.getInterpolatedValue(entry.values, lat, lons[col]!, "linear") + entry.quantum;
      if (!Number.isFinite(value)) continue;
      // Same breakpoint-index and linear RGBA blending as Open-Meteo's
      // getColor(..., colorBlend=true), but without allocations per pixel.
      let lo = 0, hi = breakpoints.length - 1, found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (value >= breakpoints[mid]!) { found = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const i = Math.max(0, found);
      const next = Math.min(colors.length - 1, i + 1);
      const a = colors[i]!, b = colors[next]!;
      const denominator = breakpoints[next]! - breakpoints[i]!;
      const blend = denominator > 0 ? Math.max(0, Math.min(1, (value - breakpoints[i]!) / denominator)) : 0;
      const dest = (row * size + col) * 4;
      rgba[dest] = a[0]! + (b[0]! - a[0]!) * blend;
      rgba[dest + 1] = a[1]! + (b[1]! - a[1]!) * blend;
      rgba[dest + 2] = a[2]! + (b[2]! - a[2]!) * blend;
      rgba[dest + 3] = 255 * (a[3]! + (b[3]! - a[3]!) * blend);
    }
  }
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("viewport-canvas-context");
  context.putImageData(new ImageData(rgba, size, size), 0, 0);
  return canvas.transferToImageBitmap();
}
port.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "clear") { entries.clear(); return; }
  if (msg.type === "evict") { entries.delete(msg.key); return; }
  if (msg.type === "register") {
    try {
      entries.set(msg.key, { values: msg.values, grid: GridFactory.create(msg.grid, msg.ranges),
        quantum: Number.isFinite(msg.scaleFactor) && (msg.scaleFactor ?? 0) > 0 ? 0.5 / msg.scaleFactor! : 0,
        palette: msg.palette });
    } catch (error) {
      port.postMessage({ type: "error", id: -1, error: String(error) });
    }
    return;
  }
  const started = performance.now();
  try {
    const entry = entries.get(msg.key);
    if (!entry) throw new Error("viewport-data-not-in-worker");
    const bitmap = paint(msg, entry);
    port.postMessage({ type: "rendered", id: msg.id, bitmap,
      durationMs: performance.now() - started }, [bitmap]);
  } catch (error) {
    port.postMessage({ type: "error", id: msg.id, error: String(error) });
  }
};

/** MyWeather viewport raster worker.
 * Reuses one already decoded ECMWF .om array across multiple raster tiles.
 * The official GridFactory supplies the SAME spatial interpolation as the
 * upstream raster worker; model values, units and colour breakpoints are not
 * modified. This worker never fetches network data. */
import { GridFactory } from "@openmeteo/weather-map-layer";
import { spatialRasterColor, spatialTileLatitude, spatialTileLongitude } from "./spatialRasterColor";
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

function paint(task: Render, entry: Entry): ImageBitmap {
  const { size, z, x, y } = task;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const lons = new Float64Array(size);
  for (let col = 0; col < size; col++) lons[col] = spatialTileLongitude(x + (col + 0.5) / size, z);
  // No allocation per pixel: reuse one four-channel colour vector.
  const colorOut = [0, 0, 0, 0];
  for (let row = 0; row < size; row++) {
    const lat = spatialTileLatitude(y + (row + 0.5) / size, z);
    for (let col = 0; col < size; col++) {
      const value = entry.grid.getInterpolatedValue(entry.values, lat, lons[col]!, "linear") + entry.quantum;
      if (!Number.isFinite(value)) continue;
      const color = spatialRasterColor(entry.palette, value, colorOut);
      const dest = (row * size + col) * 4;
      rgba[dest] = color[0]!;
      rgba[dest + 1] = color[1]!;
      rgba[dest + 2] = color[2]!;
      rgba[dest + 3] = 255 * color[3]!;
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

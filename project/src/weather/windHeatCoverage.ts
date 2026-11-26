import type { GridField } from "./types";

type Box = { south: number; north: number; west: number; east: number };
const complete = new WeakMap<GridField, boolean>();
const viewport = new WeakMap<GridField, { key: string; valid: boolean }>();
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360));
const valid = (g: GridField, i: number) => !!g.ok[i] && Number.isFinite(g.temp[i]) &&
  Number.isFinite(g.spd[i]) && Number.isFinite(g.u[i]) && Number.isFinite(g.v[i]);

/** Wind/heat only. Never fills or changes any source array. */
export function completeWindHeatGrid(g: GridField): boolean {
  const hit = complete.get(g);
  if (hit !== undefined) return hit;
  const n = g.cols * g.rows * g.hours;
  let result = n > 0;
  for (let i = 0; result && i < n; i++) result = valid(g, i);
  complete.set(g, result);
  return result;
}

/** Check every interpolation cell in the visible region and both displayed hours.
 * Geographic bounds alone cannot certify an API batch with missing observations. */
export function windHeatCoversView(g: GridField, box: Box, hour: number): boolean {
  if (completeWindHeatGrid(g)) return true;
  const span = Math.min(360, box.east - box.west);
  const d = ((box.west - g.west) % 360 + 360) % 360;
  const x = d / g.lonSpan * g.cols - 0.5;
  const c0 = Math.floor(x), c1 = Math.ceil(x + span / g.lonSpan * g.cols);
  const south = merc(g.south), extent = merc(g.north) - south;
  const r0 = Math.max(0, Math.floor((merc(box.south) - south) / extent * g.rows - 0.5));
  const r1 = Math.min(g.rows - 1, Math.ceil((merc(box.north) - south) / extent * g.rows - 0.5));
  const h = Math.max(0, Math.min(g.hours - 1, hour)), h0 = Math.floor(h), h1 = Math.ceil(h);
  const key = [c0,c1,r0,r1,h0,h1].join(":");
  const hit = viewport.get(g);
  if (hit?.key === key) return hit.valid;
  let result = span > 0 && extent > 0 && r0 <= r1;
  for (let hh = h0; result && hh <= h1; hh++)
    for (let r = r0; result && r <= r1; r++)
      for (let c = c0; result && c <= c1; c++) {
        if (!g.full && (c < 0 || c >= g.cols)) continue;
        const col = ((c % g.cols) + g.cols) % g.cols;
        result = valid(g, (hh * g.rows + r) * g.cols + col);
      }
  viewport.set(g, {key,valid:result});
  return result;
}

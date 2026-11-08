import type { LiveCyclone } from "@/weather/cyclones";

export type LatLon = { lat: number; lon: number };

export type PaintedSystem = {
  kind: "cyclone";
  name: string;
  lat: number;
  lon: number;
  pts: LatLon[];
  moveKmh: number;
  moveDir: number;
  windKmh: number;
};

export function stormGradeKey(windKmh: number): "catTd" | "catTs" | "cat1" | "cat2" | "cat3" | "cat4" | "cat5" {
  const kt = windKmh / 1.852;
  if (kt < 34) return "catTd";
  if (kt < 64) return "catTs";
  if (kt < 83) return "cat1";
  if (kt < 96) return "cat2";
  if (kt < 113) return "cat3";
  if (kt < 137) return "cat4";
  return "cat5";
}

type Pt = { x: number; y: number };

function strokeTrack(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = "rgba(12, 18, 28, 0.45)";
  ctx.lineWidth = 4.4;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 248, 236, 0.95)";
  ctx.lineWidth = 2.1;
  ctx.stroke();
  ctx.restore();
}

export function paintCyclones(
  ctx: CanvasRenderingContext2D,
  project: (lat: number, lon: number) => Pt,
  cyclones: LiveCyclone[],
  now: number,
): PaintedSystem[] {
  void now;
  const hits: PaintedSystem[] = [];
  for (const storm of cyclones) {
    const track = storm.track.length ? storm.track : [{ lat: storm.lat, lon: storm.lon }];
    const drawn = track.map((p) => project(p.lat, p.lon));
    strokeTrack(ctx, drawn);
    hits.push({
      kind: "cyclone",
      name: storm.name,
      lat: storm.lat,
      lon: storm.lon,
      pts: track,
      moveKmh: storm.moveKmh,
      moveDir: storm.moveDir,
      windKmh: storm.windKmh,
    });
  }
  return hits;
}

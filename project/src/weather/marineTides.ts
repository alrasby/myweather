import type { MarineSnap } from "./types.ts";

export type MarineTidePoint = { t: number; level: number };
export type MarineTideExtreme = MarineTidePoint & { kind: "high" | "low" };

export function seaGridDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/** Ignore inland city responses resolved to a far-off sea model grid.
 * This is only a conservative coastal heuristic, never a coastline dataset. */
export function parseMarineResponse(
  data: {
    latitude?: number; longitude?: number;
    current?: { wave_height?: number | null };
    hourly?: { time?: number[]; sea_level_height_msl?: (number | null)[] };
  },
  place: { lat: number; lon: number },
): MarineSnap {
  const sampleLat = data.latitude;
  const sampleLon = data.longitude;
  if (!Number.isFinite(sampleLat) || !Number.isFinite(sampleLon) ||
      seaGridDistanceKm(place.lat, place.lon, sampleLat!, sampleLon!) > 40) {
    return { coastal: false, wave: null };
  }
  const value = data.current?.wave_height;
  const wave = typeof value === "number" && Number.isFinite(value) ? value : null;
  const times = data.hourly?.time ?? [];
  const levels = data.hourly?.sea_level_height_msl ?? [];
  const tides: MarineTidePoint[] = [];
  for (let i = 0; i < Math.min(times.length, levels.length, 120); i++) {
    const t = times[i];
    const level = levels[i];
    if (typeof t === "number" && Number.isFinite(t) &&
        typeof level === "number" && Number.isFinite(level)) {
      tides.push({ t: t * 1000, level });
    }
  }
  return { coastal: wave !== null || tides.length >= 3, wave, tides };
}

/** Tide extrema are calculated from actual marine model sea-level samples,
 * rather than inventing an absolute tide height with generic astronomy. */
export function marineTideForecast(samples: readonly MarineTidePoint[], now: number): {
  points: MarineTidePoint[];
  events: MarineTideExtreme[];
  nextHigh: MarineTideExtreme | null;
  nextLow: MarineTideExtreme | null;
} {
  const points = samples.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.level) &&
    p.t >= now - 6 * 3600000 && p.t <= now + 36 * 3600000).sort((a, b) => a.t - b.t);
  const events: MarineTideExtreme[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    if (b.level > a.level && b.level >= c.level) events.push({ ...b, kind: "high" });
    if (b.level < a.level && b.level <= c.level) events.push({ ...b, kind: "low" });
  }
  return {
    points,
    events: events.filter((e) => e.t >= now).slice(0, 8),
    nextHigh: events.find((e) => e.kind === "high" && e.t >= now) ?? null,
    nextLow: events.find((e) => e.kind === "low" && e.t >= now) ?? null,
  };
}

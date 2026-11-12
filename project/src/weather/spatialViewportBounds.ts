/** Bounds used by Open-Meteo's updateCurrentBounds() partial .om reader.
 *
 * The global IFS model is far larger than a typical mobile viewport. Keep
 * reading a padded window around the *actual* Leaflet view, not the whole
 * globe. The upstream reader snaps this window to stable tile boundaries.
 *
 * Use the same regional window for equivalent 360-degree world copies.
 * Clamp padding near +/-180 rather than falling back to the entire globe
 * when the visible viewport itself stays on one side of the dateline.
 * A genuinely split/wrapped viewport still uses the full model safely. */
export type SpatialView = { west: number; east: number; south: number; north: number };
export type SpatialBounds = [number, number, number, number];

const LAT_LIMIT = 85.0511287798;
const GLOBAL: SpatialBounds = [-180, -LAT_LIMIT, 180, LAT_LIMIT];

export function spatialViewportBounds(view: SpatialView): SpatialBounds {
  const { west, east, south, north } = view;
  if (![west, east, south, north].every(Number.isFinite) ||
      north <= south || east <= west || east - west >= 300) return [...GLOBAL];
  const width = east - west;
  const height = north - south;

  // Leaflet preserves unwrapped longitudes across 360-degree pans. The
  // weather field is periodic in longitude, so the same regional window
  // must be requested whether a city is viewed at 20 or 380 degrees.
  const turns = Math.floor((west + 180) / 360);
  const normalizedWest = west - turns * 360;
  const normalizedEast = normalizedWest + width;
  // A truly dateline-crossing viewport cannot fit one contiguous [-180,180]
  // partial .om read; keep the existing safe global fallback for that case.
  if (normalizedWest < -180 || normalizedEast > 180) return [...GLOBAL];

  const lonPad = Math.max(0.1, width * 0.1);
  const latPad = Math.max(0.1, height * 0.1);
  // Only the *padding* can cross the dateline here. Trimming it does not
  // remove any visible area, and avoids very costly unnecessary global IO.
  const w = Math.max(-180, normalizedWest - lonPad);
  const e = Math.min(180, normalizedEast + lonPad);
  const s = Math.max(-LAT_LIMIT, south - latPad);
  const n = Math.min(LAT_LIMIT, north + latPad);
  if (s >= n || w >= e) return [...GLOBAL];
  return [w, s, e, n];
}

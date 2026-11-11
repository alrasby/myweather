/** Bounds used by Open-Meteo's updateCurrentBounds() partial .om reader.
 *
 * The global IFS model is far larger than a typical mobile viewport. Keep
 * reading a padded window around the *actual* Leaflet view, not the whole
 * globe. The upstream reader snaps this window to stable tile boundaries.
 *
 * Conservatively request the full globe if the view wraps the dateline or
 * extends past the world; a guessed 180-degree rectangle could omit valid
 * rain/snow/cloud values or show artificial empty edges. */
export type SpatialView = { west: number; east: number; south: number; north: number };
export type SpatialBounds = [number, number, number, number];

const LAT_LIMIT = 85.0511287798;
const GLOBAL: SpatialBounds = [-180, -LAT_LIMIT, 180, LAT_LIMIT];

export function spatialViewportBounds(view: SpatialView): SpatialBounds {
  const { west, east, south, north } = view;
  if (![west, east, south, north].every(Number.isFinite) ||
      north <= south || east <= west || east - west >= 300 ||
      west < -180 || east > 180) return [...GLOBAL];
  const width = east - west;
  const height = north - south;
  // Padding limits unnecessary refreshes for small gestures; the official
  // Open-Meteo implementation additionally snaps the window to its tile grid.
  const lonPad = Math.max(0.1, width * 0.1);
  const latPad = Math.max(0.1, height * 0.1);
  const w = west - lonPad;
  const e = east + lonPad;
  if (w < -180 || e > 180) return [...GLOBAL];
  const s = Math.max(-LAT_LIMIT, south - latPad);
  const n = Math.min(LAT_LIMIT, north + latPad);
  if (s >= n) return [...GLOBAL];
  return [w, s, e, n];
}

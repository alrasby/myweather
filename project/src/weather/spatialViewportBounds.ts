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

/** Full longitude is unavoidable in a single OM window when a view crosses
 * the antimeridian. The latitude need NOT span both poles, however. Avoid
 * decoding several million invisible global samples for a 20-degree band.
 * Preserve the whole requested visible latitude with 10% vertical padding.
 */
export function worldLongitudeLatitudeBand(south: number, north: number): SpatialBounds {
  if (!Number.isFinite(south) || !Number.isFinite(north) || north <= south)
    return [...GLOBAL];
  const padding = Math.max(0.1, (north - south) * 0.1);
  const s = Math.max(-LAT_LIMIT, south - padding);
  const n = Math.min(LAT_LIMIT, north + padding);
  if (s >= n) return [...GLOBAL];
  return [-180, s, 180, n];
}

export function spatialViewportBounds(view: SpatialView): SpatialBounds {
  const { west, east, south, north } = view;
  if (![west, east, south, north].every(Number.isFinite) ||
      north <= south || east <= west) return [...GLOBAL];
  const width = east - west;
  const height = north - south;
  if (width >= 300) return worldLongitudeLatitudeBand(south, north);

  // Leaflet preserves unwrapped longitudes across 360-degree pans. The
  // weather field is periodic in longitude, so the same regional window
  // must be requested whether a city is viewed at 20 or 380 degrees.
  const turns = Math.floor((west + 180) / 360);
  const normalizedWest = west - turns * 360;
  const normalizedEast = normalizedWest + width;
  // A truly dateline-crossing viewport requires full longitude for this
  // upstream single-window API, but should still read ONLY visible latitudes.
  // Using both polar caps at every dateline crossing caused massive wasted
  // binary range reads, excess WebView heap and zoom-out stalls.
  if (normalizedWest < -180 || normalizedEast > 180)
    return worldLongitudeLatitudeBand(south, north);

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

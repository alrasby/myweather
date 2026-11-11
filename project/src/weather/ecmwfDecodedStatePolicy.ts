/** Open-Meteo weather-map-layer's default maxStatesWithData is 2,
 * but MyWeather displays THREE variables per forecast hour:
 * cloud_cover, precipitation, snowfall_water_equivalent.
 *
 * One ready hour + its adjacent preloaded hour requires 3 * 2 = 6
 * decoded states. A lower limit repeatedly evicts model fields before
 * consecutive Leaflet tiles can reuse them, causing OM re-read/redecode.
 *
 * This is a count cap (not a byte quota). Keep it conservative for Android
 * without SharedArrayBuffer; the viewport-cropped read path bounds size.
 * Do not start a second speculative hour beyond the adjacent frame. */
export const ECMWF_FIELDS_PER_HOUR = 3;
export const ECMWF_RETAINED_HOURS = 2;
export const ECMWF_DECODED_STATE_LIMIT = ECMWF_FIELDS_PER_HOUR * ECMWF_RETAINED_HOURS;

export function nextEcmwfFrameToPrepare(
  requested: number,
  total: number,
  ready: ReadonlySet<number>,
): number | null {
  if (requested < 0 || requested >= total) return null;
  if (!ready.has(requested)) return requested;
  const next = requested + 1;
  return next < total && !ready.has(next) ? next : null;
}

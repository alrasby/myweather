import { sunArc } from "./astro.ts";

import type { Place, WeatherBundle } from "./types.ts";

/** sunArc expects 12:00 UTC of the LOCAL calendar date, NOT local noon
 * converted to UTC. Applying the timezone offset before sunArc already
 * applies the longitude offset twice (Muscat: -4h; New York: +5h). */
export function solarEventsForDate(localDate: string, lat: number, lon: number): { rise: number; set: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return { rise: NaN, set: NaN };
  const noonUtc = Date.parse(`${localDate}T12:00:00Z`);
  return sunArc(lat, lon, noonUtc);
}

/** Repair only astronomically impossible cached sunrise/sunset shifts.
 * Old MET.no bundles can be fresh for 20min following an APK upgrade.
 * Preserve Open-Meteo events when they are already plausible, because
 * provider data is more accurate than the local approximate sunArc.
 */
export function repairSolarForecast(bundle: WeatherBundle, place: Pick<Place, "lat" | "lon">): WeatherBundle {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) >= 60) return bundle;
  let modified = false;
  const dateFormatter = (() => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: bundle.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      });
    } catch { return null; }
  })();
  if (!dateFormatter) return bundle;
  const days = bundle.daily.map((day) => {
    if (!Number.isFinite(day.t)) return day;
    const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(day.t))
      .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    const expected = solarEventsForDate(key, place.lat, place.lon);
    const duration = (expected.set - expected.rise) / 3_600_000;
    if (!Number.isFinite(expected.rise) || duration < 6 || duration > 18) return day;
    const inconsistent = !Number.isFinite(day.sunrise) || !Number.isFinite(day.sunset) ||
      Math.abs(day.sunrise - expected.rise) > 2 * 3_600_000 ||
      Math.abs(day.sunset - expected.set) > 2 * 3_600_000;
    if (!inconsistent) return day;
    modified = true;
    return { ...day, sunrise: expected.rise, sunset: expected.set };
  });
  return modified ? { ...bundle, daily: days } : bundle;
}

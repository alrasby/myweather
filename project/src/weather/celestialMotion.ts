import { lunarHorizonPass, moonState, sunArc } from "./astro.ts";

export type CelestialBody = {
  progress: number;
  rise: number | null;
  set: number | null;
  continuous: boolean;
};
export type CelestialSky = {
  sun: CelestialBody | null;
  moon: CelestialBody | null;
  phase: number;
  illumination: number;
  moonRotation: number;
};

/** An illustrative right-to-left passage, not an azimuth/compass projection. */
export function orbitPoint(progress: number): { x: number; arch: number } {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return { x: 1 - p, arch: 4 * p * (1 - p) };
}

export function celestialMotion(lat: number, lon: number, now: number,
  daily?: readonly { sunrise: number; sunset: number }[]): CelestialSky {
  const result: CelestialSky = { sun: null, moon: null, phase: 0, illumination: 0, moonRotation: lat < 0 ? 180 : 0 };
  if (![lat, lon, now].every(Number.isFinite) || !Number.isFinite(new Date(now).getTime()) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return result;
  const lunar = moonState(now);
  result.phase = lunar.frac;
  result.illumination = lunar.illum;
  const body = (rise: number, set: number): CelestialBody => ({ rise, set, continuous: false, progress: (now - rise) / (set - rise) });
  // Prefer matching source events. Only this city's snapshot is passed by the UI.
  const source = daily?.filter(d => Number.isFinite(d.sunrise) && Number.isFinite(d.sunset)
    && d.sunset > d.sunrise && d.sunset - d.sunrise < 24 * 3_600_000)
    .reduce<{ sunrise: number; sunset: number } | null>((best, d) => !best ||
      Math.abs(now - (d.sunrise + d.sunset) / 2) < Math.abs(now - (best.sunrise + best.sunset) / 2) ? d : best, null);
  const sourceCoversDate = source && Math.abs(now - (source.sunrise + source.sunset) / 2) < 20 * 3_600_000;
  if (sourceCoversDate) {
    if (now >= source.sunrise && now < source.sunset) result.sun = body(source.sunrise, source.sunset);
  }
  else {
    const date = new Date(now);
    const noon = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12);
    for (const shift of [-86_400_000, 0, 86_400_000]) {
      const events = sunArc(lat, lon, noon + shift);
      if (now < events.rise || now >= events.set) continue;
      result.sun = events.set - events.rise >= 23.99 * 3_600_000
        ? { rise: null, set: null, continuous: true, progress: 0.5 }
        : body(events.rise, events.set);
      break;
    }
  }
  const pass = lunarHorizonPass(lat, lon, now);
  // New moons are not painted as conspicuous full discs against daylight.
  if (pass && lunar.illum >= 0.015) {
    result.moon = pass.rise !== null && pass.set !== null
      ? body(pass.rise, pass.set)
      : { rise: null, set: null, continuous: true, progress: 0.5 };
  }
  return result;
}

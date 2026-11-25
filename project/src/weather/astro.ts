/** حسابات فلكية محلية: قوس الشمس، عمر القمر، اتجاه الضغط. */

const SYNODIC = 29.530588853;
/** Schlyter orbital elements use 1999-12-31 00:00 UTC, NOT J2000 noon.
 * Reference: https://stjarnhimlen.se/comp/ppcomp.html sections 3, 9, 15. */
const ORBIT_EPOCH = Date.UTC(1999, 11, 31);
function sunLongitude(ms: number): number {
  const d = (ms - ORBIT_EPOCH) / 86_400_000;
  const w = rad(282.9404 + 4.70935e-5 * d);
  const e = 0.016709 - 1.151e-9 * d;
  const m = rad(356.0470 + 0.9856002585 * d);
  let E = m;
  for (let k = 0; k < 8; k++) E = m + e * Math.sin(E);
  return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e) + w;
}

export function sunProgress(nowMs: number, sunriseMs: number, sunsetMs: number): number {
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs) || sunsetMs <= sunriseMs) return 0;
  if (nowMs <= sunriseMs) return 0;
  if (nowMs >= sunsetMs) return 1;
  return (nowMs - sunriseMs) / (sunsetMs - sunriseMs);
}

function solarDecl(ms: number): number {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((ms - start) / 86_400_000);
  return 23.44 * Math.cos((2 * Math.PI * (doy - 172)) / 365);
}

function solarSpan(lat: number, lon: number, noonUtc: number): { rise: number; set: number } {
  const decl = (solarDecl(noonUtc) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const arg = -Math.tan(phi) * Math.tan(decl);
  const ha = Math.abs(arg) > 1 ? (arg < 0 ? Math.PI : 0) : Math.acos(arg);
  const half = (ha / (2 * Math.PI)) * 24;
  const solarNoon = noonUtc + (-lon / 15) * 3_600_000;
  return { rise: solarNoon - half * 3_600_000, set: solarNoon + half * 3_600_000 };
}

export function sunArc(lat: number, lon: number, noonUtc: number): { rise: number; set: number } {
  return solarSpan(lat, lon, noonUtc);
}

/** هل الشمس فوق الأفق عند هذا التوقيت؟ يغطي اليوم المجاور قرب خط التاريخ. */
export function solarDaylight(lat: number, lon: number, ms: number): boolean {
  const d = new Date(ms);
  const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
  for (const shift of [0, -86_400_000, 86_400_000]) {
    const sun = solarSpan(lat, lon, noon + shift);
    if (ms >= sun.rise && ms < sun.set) return true;
  }
  return false;
}

/** نهار حقيقي: غروب اليوم، وإلا أقرب ساعة، وإلا الحساب الفلكي. لا يُؤخذ من ثيم الواجهة. */
export function daylightNow(
  now: number,
  lat: number,
  lon: number,
  daily?: { sunrise: number; sunset: number }[],
  hourly?: { t: number; isDay: boolean }[],
): boolean {
  if (daily?.length) {
    let best: { sunrise: number; sunset: number } | null = null;
    let bestD = Infinity;
    for (const day of daily) {
      if (!Number.isFinite(day.sunrise) || !Number.isFinite(day.sunset) || day.sunset <= day.sunrise) continue;
      const dist = Math.abs(now - (day.sunrise + day.sunset) / 2);
      if (dist < bestD) {
        best = day;
        bestD = dist;
      }
    }
    if (best && bestD < 20 * 3_600_000) return now >= best.sunrise && now < best.sunset;
  }
  if (hourly?.length) {
    let best = hourly[0]!;
    let bestD = Infinity;
    for (const row of hourly) {
      const dist = Math.abs(row.t - now);
      if (dist < bestD) {
        best = row;
        bestD = dist;
      }
    }
    if (bestD < 3 * 3_600_000) return best.isDay;
  }
  return solarDaylight(lat, lon, now);
}

export function moonState(nowMs: number): { age: number; frac: number; illum: number } {
  if (!Number.isFinite(new Date(nowMs).getTime())) return { age: 0, frac: 0, illum: 0 };
  const moon = moonEquatorial(nowMs);
  const elongation = ((moon.longitude - sunLongitude(nowMs)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const frac = elongation / (2 * Math.PI);
  const illum = (1 - Math.cos(elongation) * Math.cos(moon.latitude)) / 2;
  return { age: frac * SYNODIC, frac, illum };
}

export function pressureDelta(current: number, past: number | null): number {
  if (past == null || !Number.isFinite(past) || !Number.isFinite(current)) return 0;
  return current - past;
}

export function pressureTrend(delta: number): "rising" | "falling" | "steady" {
  if (delta >= 0.8) return "rising";
  if (delta <= -0.8) return "falling";
  return "steady";
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function moonEquatorial(ms: number): { ra: number; dec: number; longitude: number; latitude: number } {
  const d = (ms - ORBIT_EPOCH) / 86_400_000;
  const N = rad(125.1228 - 0.0529538083 * d);
  const i = rad(5.1454);
  const w = rad(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.0549;
  const M = rad(115.3654 + 13.0649929509 * d);
  let E = M;
  for (let k = 0; k < 8; k++) E = M + e * Math.sin(E);
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * Math.sin(v + w) * Math.sin(i);
  const msun = rad(356.0470 + 0.9856002585 * d);
  const wsun = rad(282.9404 + 4.70935e-5 * d);
  const L = M + w + N, D = L - msun - wsun, F = L - N;
  const sin = Math.sin;
  const lonecl = Math.atan2(yh, xh) + rad(
    -1.274*sin(M-2*D) + 0.658*sin(2*D) - 0.186*sin(msun)
    -0.059*sin(2*M-2*D) - 0.057*sin(M-2*D+msun) + 0.053*sin(M+2*D)
    +0.046*sin(2*D-msun) + 0.041*sin(M-msun) - 0.035*sin(D)
    -0.031*sin(M+msun) - 0.015*sin(2*F-2*D) + 0.011*sin(M-4*D));
  const latecl = Math.atan2(zh, Math.hypot(xh, yh)) + rad(
    -0.173*sin(F-2*D) - 0.055*sin(M-F-2*D) - 0.046*sin(M+F-2*D)
    +0.033*sin(F+2*D) + 0.017*sin(2*M+F));
  const obl = rad(23.4393 - 3.563e-7 * d);
  const xeq = Math.cos(lonecl) * Math.cos(latecl);
  const yeq = Math.sin(lonecl) * Math.cos(latecl) * Math.cos(obl) - Math.sin(latecl) * Math.sin(obl);
  const zeq = Math.sin(lonecl) * Math.cos(latecl) * Math.sin(obl) + Math.sin(latecl) * Math.cos(obl);
  return { ra: Math.atan2(yeq, xeq), dec: Math.atan2(zeq, Math.hypot(xeq, yeq)), longitude: lonecl, latitude: latecl };
}

function moonAlt(ms: number, lat: number, lon: number): number {
  const { ra, dec } = moonEquatorial(ms);
  const d = (ms - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86_400_000;
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const lst = ((gmst + lon / 15) * Math.PI) / 12;
  const ha = lst - ra;
  const phi = rad(lat);
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt)));
}

/** Show the moon in the home sky only while it is above this city's horizon.
 * Reuses the same lunar coordinates already used for moonrise/set instead of
 * treating every night as a moonlit night. */
export function moonAboveHorizon(lat: number, lon: number, now: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(new Date(now).getTime()) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return moonAlt(now, lat, lon) > rad(0.13);
}

/** Moon rise/set in the *place's current local calendar day*, not merely
 * the next event after the device clock. The old 23-hour forward-only scan
 * incorrectly displayed — if today's rise happened >3h before now.
 *
 * No crossing on a particular day is physically possible (especially
 * high-latitude cities); return null rather than fabricating a moon event.
 * Formula is approximate, not an observatory ephemeris. */
export function moonRiseSet(
  lat: number, lon: number, now: number, timeZone = "UTC",
): { rise: number | null; set: number | null } {
  if (![lat, lon, now].every(Number.isFinite) || !Number.isFinite(new Date(now).getTime()) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { rise: null, set: null };
  }
  let dateFormatter: Intl.DateTimeFormat;
  try {
    dateFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return { rise: null, set: null };
  }
  const localDay = (ms: number): string => {
    const parts = dateFormatter.formatToParts(new Date(ms));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const targetDay = localDay(now);
  const step = 10 * 60_000;
  // A +/-40h UTC search spans the entire local day even at UTC+14 / UTC-12.
  const start = now - 40 * 3_600_000;
  const end = now + 40 * 3_600_000;
  // Approximate rise of the lunar *upper limb*: parallax ~0.95 degrees,
  // refraction ~0.57 and semidiameter ~0.25 => geocentric centre ~+0.13.
  const lunarHorizon = rad(0.13);
  let rise: number | null = null;
  let set: number | null = null;
  let prevT = start;
  let previousAlt = moonAlt(start, lat, lon) - lunarHorizon;
  for (let ms = start + step; ms <= end; ms += step) {
    const altitude = moonAlt(ms, lat, lon) - lunarHorizon;
    const rising = previousAlt < 0 && altitude >= 0;
    const setting = previousAlt >= 0 && altitude < 0;
    if (rising || setting) {
      const fraction = Math.max(0, Math.min(1, -previousAlt / (altitude - previousAlt)));
      const instant = prevT + fraction * step;
      if (localDay(instant) === targetDay) {
        if (rising && rise === null) rise = instant;
        if (setting && set === null) set = instant;
      }
    }
    if (rise !== null && set !== null) break;
    previousAlt = altitude;
    prevT = ms;
  }
  return { rise, set };
}

export type TideExtreme = { t: number; level: number; kind: "high" | "low" };

function tideLevel(lat: number, lon: number, ms: number): number {
  const t = ms / 3_600_000;
  const phase = (lon * Math.PI) / 180;
  const latF = 0.42 + 0.7 * Math.cos((lat * Math.PI) / 180) ** 2;
  const m2 = latF * 0.78 * Math.cos((2 * Math.PI * t) / 12.4206012 + phase * 2);
  const s2 = latF * 0.26 * Math.cos((2 * Math.PI * t) / 12 + phase * 1.6);
  const k1 = latF * 0.18 * Math.cos((2 * Math.PI * t) / 23.934472 + phase);
  const o1 = latF * 0.12 * Math.cos((2 * Math.PI * t) / 25.81934 + phase * 0.4);
  return m2 + s2 + k1 + o1;
}

export function tideForecast(lat: number, lon: number, now: number): {
  points: { t: number; level: number }[];
  events: TideExtreme[];
  nextHigh: TideExtreme | null;
  nextLow: TideExtreme | null;
} {
  const step = 10 * 60_000;
  const from = now - 4 * 3_600_000;
  const to = now + 36 * 3_600_000;
  const samples: { t: number; level: number }[] = [];
  for (let t = from; t <= to; t += step) samples.push({ t, level: tideLevel(lat, lon, t) });
  const events: TideExtreme[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const c = samples[i + 1]!;
    if (b.level >= a.level && b.level >= c.level) events.push({ t: b.t, level: b.level, kind: "high" });
    else if (b.level <= a.level && b.level <= c.level) events.push({ t: b.t, level: b.level, kind: "low" });
  }
  const upcoming = events.filter((e) => e.t >= now - 5 * 60_000);
  return {
    points: samples.filter((p) => p.t >= now - 3 * 3_600_000 && p.t <= now + 18 * 3_600_000),
    events: upcoming.slice(0, 4),
    nextHigh: upcoming.find((e) => e.kind === "high") ?? null,
    nextLow: upcoming.find((e) => e.kind === "low") ?? null,
  };
}


/** Nearby lunar horizon crossings, independent of the device's calendar zone.
 * Bounded hourly cache avoids scanning on every sky-clock update. */
const lunarPassCache = new Map<string, { rises: number[]; sets: number[] }>();
export function lunarHorizonPass(lat: number, lon: number, now: number): {
  rise: number | null; set: number | null;
} | null {
  if (![lat, lon, now].every(Number.isFinite) || !Number.isFinite(new Date(now).getTime()) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const threshold = rad(0.13);
  if (moonAlt(now, lat, lon) <= threshold) return null;
  const hour = Math.floor(now / 3_600_000);
  const key = `${lat}:${lon}:${hour}`;
  let events = lunarPassCache.get(key);
  if (!events) {
    events = { rises: [], sets: [] };
    const step = 10 * 60_000;
    const start = hour * 3_600_000 - 36 * 3_600_000;
    let previous = moonAlt(start, lat, lon) - threshold;
    for (let t = start + step; t <= start + 72 * 3_600_000; t += step) {
      const altitude = moonAlt(t, lat, lon) - threshold;
      if ((previous < 0 && altitude >= 0) || (previous >= 0 && altitude < 0)) {
        // Refine the bracket so hourly cache rotation cannot jump the orbit.
        let lo = t - step, hi = t;
        const rising = previous < 0;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          if ((moonAlt(mid, lat, lon) >= threshold) === rising) hi = mid;
          else lo = mid;
        }
        (rising ? events.rises : events.sets).push((lo + hi) / 2);
      }
      previous = altitude;
    }
    if (lunarPassCache.size >= 16) lunarPassCache.delete(lunarPassCache.keys().next().value!);
    lunarPassCache.set(key, events);
  }
  const rise = events.rises.filter(t => t <= now).at(-1) ?? null;
  const set = events.sets.find(t => t > now) ?? null;
  return { rise, set };
}

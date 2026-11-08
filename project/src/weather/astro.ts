/** حسابات فلكية محلية: قوس الشمس، عمر القمر، اتجاه الضغط. */

const SYNODIC = 29.530588853;
/** محاق معروف: 6 يناير 2000، 18:14 UTC. */
const MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);

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
  const days = (nowMs - MOON_EPOCH) / 86_400_000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const frac = age / SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  return { age, frac, illum };
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

function moonEquatorial(ms: number): { ra: number; dec: number } {
  const d = (ms - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86_400_000;
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
  const lonecl = Math.atan2(yh, xh);
  const latecl = Math.atan2(zh, Math.hypot(xh, yh));
  const obl = rad(23.4393 - 3.563e-7 * d);
  const xeq = Math.cos(lonecl) * Math.cos(latecl);
  const yeq = Math.sin(lonecl) * Math.cos(latecl) * Math.cos(obl) - Math.sin(latecl) * Math.sin(obl);
  const zeq = Math.sin(lonecl) * Math.cos(latecl) * Math.sin(obl) + Math.sin(latecl) * Math.cos(obl);
  return { ra: Math.atan2(yeq, xeq), dec: Math.atan2(zeq, Math.hypot(xeq, yeq)) };
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

export function moonRiseSet(lat: number, lon: number, now: number): { rise: number | null; set: number | null } {
  const t0 = now - 3 * 3_600_000;
  let rise: number | null = null;
  let set: number | null = null;
  let prevT = t0;
  let prev = moonAlt(t0, lat, lon);
  for (let i = 1; i <= 26 * 30; i++) {
    const t = t0 + i * 120_000;
    const alt = moonAlt(t, lat, lon);
    if (rise == null && prev < 0 && alt >= 0 && t >= now - 20 * 60_000) {
      rise = prevT + ((0 - prev) / (alt - prev || 1)) * 120_000;
    }
    if (set == null && prev >= 0 && alt < 0 && t >= now - 20 * 60_000) {
      set = prevT + ((0 - prev) / (alt - prev || 1)) * 120_000;
    }
    prev = alt;
    prevT = t;
    if (rise != null && set != null) break;
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


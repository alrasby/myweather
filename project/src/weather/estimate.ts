import type { AirQuality, DayPoint, GridField, HourPoint, Place, WeatherBundle } from "@/weather/types";
import { solarDaylight } from "@/weather/astro";
import { mercToLat, mercY } from "@/weather/grid";

/** تقدير مناخي فوري عند انقطاع Open-Meteo — يُستبدل بالرصد الحقيقي متى نجح الطلب. */

function dayOfYear(ms: number): number {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((ms - start) / 86_400_000);
}

function declination(ms: number): number {
  const doy = dayOfYear(ms);
  return 23.44 * Math.cos((2 * Math.PI * (doy - 172)) / 365);
}

function localHour(ms: number, lon: number): number {
  const d = new Date(ms);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15;
}

export function estimateTemp(lat: number, lon: number, ms: number): number {
  const decl = declination(ms);
  const zonal = Math.cos(((lat - decl) * Math.PI) / 180);
  const peak = 8 + 24 * Math.max(0, zonal);
  const hour = ((localHour(ms, lon) % 24) + 24) % 24;
  const diurnal = Math.cos(((hour - 15) / 24) * 2 * Math.PI);
  const coast = 1.5 * Math.sin((lon * Math.PI) / 90);
  return peak + 6.5 * diurnal + coast;
}

function estimateWind(lat: number, lon: number, ms: number): { u: number; v: number; spd: number; dir: number } {
  const band = Math.cos((lat * Math.PI) / 180);
  let u = 0;
  let v = 0;
  if (Math.abs(lat) < 28) {
    u = lat >= 0 ? -16 * band : 16 * band;
    v = -4 * Math.sin((lat * Math.PI) / 30);
  } else if (Math.abs(lat) < 62) {
    u = 28 * Math.sign(Math.cos((lat * Math.PI) / 180)) * (0.4 + 0.6 * Math.abs(Math.sin((lat * Math.PI) / 90)));
    v = 6 * Math.sin((lon * Math.PI) / 50);
  } else {
    u = -18;
    v = 4;
  }
  u += 18 * Math.sin((lon * Math.PI) / 48) * Math.cos((lat * Math.PI) / 70);
  v += 12 * Math.cos((lon * Math.PI) / 36) * Math.sin((lat * Math.PI) / 50);
  const wobble = 4 * Math.sin(ms / 3_600_000 + lon * 0.05);
  u += wobble;
  const spd = Math.min(120, Math.hypot(u, v));
  const to = (Math.atan2(u, v) * 180) / Math.PI;
  const dir = (((to + 180) % 360) + 360) % 360;
  return { u, v, spd, dir };
}

/** ضغط تقريبي بأخاديد أعرض من خطوة الشبكة العالمية، ويُستبدل بالرصد. */
function estimateMsl(lat: number, lon: number): number {
  const n = ((((lon + 180) % 360) + 360) % 360) - 180;
  const wrap = (a: number, b: number) => {
    const d = ((((a - b) % 360) + 540) % 360) - 180;
    return d * d;
  };
  const ridge = 8 * Math.exp(-((lat - 32) ** 2) / 180);
  const itcz = -6 * Math.exp(-((lat - 8) ** 2) / 50);
  const band = (lon0: number, lat0: number, wLon: number, wLat: number, depth: number) =>
    -depth * Math.exp(-wrap(n, lon0) / wLon) * Math.exp(-((lat - lat0) ** 2) / wLat);
  return Math.max(986, Math.min(1036, 1016 + ridge + itcz + band(58, 22, 300, 380, 14) + band(38, 24, 320, 400, 11) + band(28, 40, 360, 280, 10) + band(88, 16, 340, 360, 9) + band(-35, 45, 400, 320, 10) + band(170, -40, 420, 360, 9)));
}

function estimateRain(lat: number, lon: number, ms: number): number {
  const decl = declination(ms);
  const itcz = Math.exp(-((lat - decl * 0.35) ** 2) / 90);
  const storm = Math.exp(-((Math.abs(lat) - 48) ** 2) / 80);
  const wave = 0.55 + 0.45 * Math.sin((lon * Math.PI) / 48 + ms / 8_000_000);
  const mm = (itcz * 1.4 + storm * 0.45) * wave;
  return mm < 0.15 ? 0 : Math.round(mm * 10) / 10;
}

function codeFor(temp: number, rain: number, cloud: number): number {
  if (rain >= 6) return temp <= 0.6 ? 75 : 65;
  if (rain >= 1.2) return temp <= 0.6 ? 73 : 63;
  if (rain >= 0.3) return temp <= 0.6 ? 71 : 61;
  if (cloud > 85) return 3;
  if (cloud > 45) return 2;
  if (cloud > 18) return 1;
  return 0;
}

function cloudFor(rain: number, lat: number): number {
  return Math.max(5, Math.min(100, rain * 28 + 20 + 15 * Math.cos((lat * Math.PI) / 40)));
}

function sunSpan(lat: number, lon: number, noonUtc: number): { rise: number; set: number } {
  const decl = (declination(noonUtc) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const arg = -Math.tan(phi) * Math.tan(decl);
  const ha = Math.abs(arg) > 1 ? (arg < 0 ? Math.PI : 0) : Math.acos(arg);
  const half = (ha / (2 * Math.PI)) * 24;
  const solarNoon = noonUtc + (-lon / 15) * 3_600_000;
  return {
    rise: solarNoon - half * 3_600_000,
    set: solarNoon + half * 3_600_000,
  };
}

export function estimateBundle(place: Place, hours = 48): WeatherBundle {
  const now = Date.now();
  const offsetHours = Math.max(-12, Math.min(14, Math.round(place.lon / 15)));
  const offset = offsetHours * 3600;
  const timezone = offsetHours === 0 ? "UTC" : `Etc/GMT${offsetHours > 0 ? "-" : "+"}${Math.abs(offsetHours)}`;
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 6 * 3_600_000;
  const hourly: HourPoint[] = [];
  for (let i = 0; i < hours + 6; i++) {
    const t = start + i * 3_600_000;
    const temp = estimateTemp(place.lat, place.lon, t);
    const wind = estimateWind(place.lat, place.lon, t);
    const precip = estimateRain(place.lat, place.lon, t);
    const cloud = cloudFor(precip, place.lat);
    const lh = ((localHour(t, place.lon) % 24) + 24) % 24;
    hourly.push({
      t,
      temp,
      precip,
      pop: Math.max(0, Math.min(100, precip * 42)),
      code: codeFor(temp, precip, cloud),
      wind: wind.spd,
      gust: wind.spd * 1.35,
      feels: temp + (place.lat > 20 ? 1.2 : -0.4) - wind.spd * 0.04,
      uv: lh > 9 && lh < 15 ? Math.max(0, 8 * Math.cos(((place.lat - declination(t)) * Math.PI) / 180)) : 0,
      isDay: solarDaylight(place.lat, place.lon, t),
      pressure: 1013 + 8 * Math.sin((place.lat * Math.PI) / 45) + 2 * Math.sin(i / 5),
    });
  }
  const nearest = hourly.reduce((best, h) =>
    Math.abs(h.t - now) < Math.abs(best.t - now) ? h : best,
  );
  const daily: DayPoint[] = [];
  const day0 = new Date();
  day0.setUTCHours(12, 0, 0, 0);
  for (let d = 0; d < 15; d++) {
    const noon = day0.getTime() + d * 86_400_000;
    const temps = [0, 6, 12, 15, 21].map((h) => estimateTemp(place.lat, place.lon, noon - 12 * 3_600_000 + h * 3_600_000));
    const tmax = Math.max(...temps);
    const tmin = Math.min(...temps);
    const rain = estimateRain(place.lat, place.lon, noon);
    const wind = estimateWind(place.lat, place.lon, noon);
    const sun = sunSpan(place.lat, place.lon, noon);
    daily.push({
      t: noon - 12 * 3_600_000,
      code: codeFor(tmax, rain, cloudFor(rain, place.lat)),
      tmax,
      tmin,
      sunrise: sun.rise,
      sunset: sun.set,
      precip: rain * 6,
      pop: Math.max(0, Math.min(100, rain * 50)),
      uv: Math.max(0, 9 * Math.cos(((place.lat - declination(noon)) * Math.PI) / 180)),
      wind: wind.spd + 4,
    });
  }
  const air: AirQuality = {
    aqi: Math.round(42 + (Math.abs(place.lat) < 32 ? 28 : 8)),
    pm25: Math.abs(place.lat) < 32 ? 18 : 8,
    pm10: Math.abs(place.lat) < 32 ? 42 : 14,
    dust: Math.abs(place.lat) > 15 && Math.abs(place.lat) < 35 ? 48 : 6,
    dustHourly: hourly.slice(0, 48).map((h) => ({ t: h.t, v: Math.abs(place.lat) < 35 ? 20 + 10 * Math.sin(h.t / 7e6) : 4 })),
  };
  return {
    placeId: place.id,
    timezone,
    offset,
    fetchedAt: now,
    current: {
      t: nearest.t,
      temp: nearest.temp,
      feels: nearest.feels,
      humidity: Math.round(48 + estimateRain(place.lat, place.lon, now) * 18),
      precip: nearest.precip,
      code: nearest.code,
      cloud: cloudFor(nearest.precip, place.lat),
      pressure: nearest.pressure,
      wind: nearest.wind,
      gust: nearest.gust,
      dir: estimateWind(place.lat, place.lon, now).dir,
      visibility: nearest.precip > 1 ? 8000 : 16000,
      isDay: nearest.isDay,
    },
    hourly,
    daily,
    air,
    marine: null,
  };
}

export function estimateGrid(opts: {
  south: number;
  north: number;
  west: number;
  lonSpan: number;
  cols: number;
  rows: number;
  hours: number;
  full: boolean;
}): GridField {
  const { cols, rows, hours, south, north, west, lonSpan, full } = opts;
  const n = hours * rows * cols;
  const temp = new Float32Array(n);
  const rain = new Float32Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const spd = new Float32Array(n);
  const msl = new Float32Array(n);
  const cloud = new Float32Array(n);
  const snow = new Float32Array(n);
  const snowDepth = new Float32Array(n);
  msl.fill(1013);
  const ok = new Uint8Array(n);
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const times = Array.from({ length: hours }, (_, i) => start + i * 3_600_000);
  const mS = mercY(south);
  const mN = mercY(north);
  for (let r = 0; r < rows; r++) {
    const lat = mercToLat(mS + ((r + 0.5) * (mN - mS)) / rows);
    for (let c = 0; c < cols; c++) {
      const lon = west + ((c + 0.5) * lonSpan) / cols;
      for (let h = 0; h < hours; h++) {
        const ms = times[h]!;
        const o = (h * rows + r) * cols + c;
        const wind = estimateWind(lat, lon, ms);
        temp[o] = estimateTemp(lat, lon, ms);
        rain[o] = estimateRain(lat, lon, ms);
        cloud[o] = cloudFor(rain[o]!, lat);
        u[o] = wind.u;
        v[o] = wind.v;
        spd[o] = wind.spd;
        msl[o] = estimateMsl(lat, lon);
        ok[o] = 1;
      }
    }
  }
  return {
    id: `est|${full ? "F" : "D"}|${cols}x${rows}|${hours}|${south.toFixed(1)}|${west.toFixed(1)}|m2`,
    cols,
    rows,
    hours,
    south,
    north,
    west,
    lonSpan,
    full,
    times,
    temp,
    rain,
    u,
    v,
    spd,
    msl,
    cloud,
    snow,
    snowDepth,
    ok,
  };
}

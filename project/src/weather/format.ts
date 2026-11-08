import { t, type CopyKey } from "@/weather/i18n";
import { localeFor, textBase } from "@/weather/locale";
import type { DistanceUnit, Lang, PressureUnit, TempUnit, WindUnit } from "@/weather/types";

export function convertTemp(c: number, unit: TempUnit): number {
  return unit === "f" ? (c * 9) / 5 + 32 : c;
}

export function formatTemp(c: number, unit: TempUnit, lang: Lang): string {
  if (!Number.isFinite(c)) return "—";
  const n = new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 0 }).format(
    Math.round(convertTemp(c, unit)),
  );
  return `${n}°`;
}

export function convertWind(kmh: number, unit: WindUnit): number {
  if (unit === "ms") return kmh / 3.6;
  if (unit === "mph") return kmh * 0.621371;
  if (unit === "kn") return kmh * 0.539957;
  return kmh;
}

export function formatWind(kmh: number, unit: WindUnit, lang: Lang): string {
  if (!Number.isFinite(kmh)) return "—";
  const digits = unit === "ms" ? 1 : 0;
  const n = new Intl.NumberFormat(localeFor(lang), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(convertWind(kmh, unit));
  return `${n} ${t(lang, unit as CopyKey)}`;
}

export function formatPressure(hpa: number, unit: PressureUnit, lang: Lang): string {
  if (!Number.isFinite(hpa)) return "—";
  const v = unit === "inhg" ? hpa / 33.8638866667 : hpa;
  const digits = unit === "inhg" ? 2 : 1;
  const n = new Intl.NumberFormat(localeFor(lang), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(v);
  return `${n} ${t(lang, unit === "inhg" ? "inhg" : "hpa")}`;
}

export function formatDistance(meters: number, unit: DistanceUnit, lang: Lang): string {
  if (!Number.isFinite(meters)) return "—";
  const km = meters / 1000;
  const v = unit === "mi" ? km * 0.621371 : km;
  const n = new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 1 }).format(v);
  return `${n} ${t(lang, unit === "mi" ? "mi" : "km")}`;
}

export function formatNumber(n: number, lang: Lang, digits = 0): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(localeFor(lang), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function formatPercent(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatNumber(Math.round(n), lang)}%`;
}

export function dayKey(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function shiftKey(key: string, days: number): string {
  const utc = new Date(`${key}T12:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatDayLabel(ms: number, timeZone: string, lang: Lang, now = Date.now()): string {
  const key = dayKey(ms, timeZone);
  const today = dayKey(now, timeZone);
  if (key === today) return t(lang, "today");
  if (key === shiftKey(today, 1)) return t(lang, "tomorrow");
  try {
    return new Intl.DateTimeFormat(localeFor(lang), { weekday: "long", timeZone }).format(new Date(ms));
  } catch {
    return key;
  }
}

export function formatHour24(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const hour = String(Number(parts.find((p) => p.type === "hour")?.value ?? "0"));
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
  } catch {
    return "0:00";
  }
}

export function formatHour(ms: number, timeZone: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

export function formatDayDate(ms: number, timeZone: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      day: "numeric",
      month: "short",
      timeZone,
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

export function formatSignedMeters(m: number, lang: Lang): string {
  if (!Number.isFinite(m)) return "—";
  const sign = m > 0.005 ? "+" : m < -0.005 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(m), lang, 2)} ${t(lang, "meter")}`;
}

export function formatMeters(m: number, lang: Lang, digits = 1): string {
  if (!Number.isFinite(m)) return "—";
  return `${formatNumber(m, lang, digits)} ${t(lang, "meter")}`;
}

export function formatFullDate(ms: number, timeZone: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toDateString();
  }
}

export function formatClock(ms: number, timeZone: string, lang: Lang): string {
  const label = formatHour(ms, timeZone, lang);
  const day = formatDayLabel(ms, timeZone, lang);
  if (day === t(lang, "today") || day === t(lang, "tomorrow")) return `${day} ${label}`;
  return label;
}

export function placeTitle(place: { name: string; nameEn?: string }, lang: Lang): string {
  if (textBase() === "ar" || lang === "ar") return place.name;
  return place.nameEn || place.name;
}

export function placeCountry(
  place: { country: string; countryEn?: string },
  lang: Lang,
): string {
  if (textBase() === "ar" || lang === "ar") return place.country;
  return place.countryEn || place.country;
}

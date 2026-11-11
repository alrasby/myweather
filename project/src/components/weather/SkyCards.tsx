import { Droplets, Eye, Gauge, Leaf, SunMedium, Sunrise, Sunset } from "lucide-react";
import type { ReactNode } from "react";
import { MoonDisc } from "@/components/weather/SkyBackdrop";
import { moonRiseSet, moonState, pressureDelta, pressureTrend, sunProgress, tideForecast } from "@/weather/astro";
import { qiblaBearing, relativeQiblaDirection } from "@/weather/qibla";
import type { CompassReading } from "@/weather/deviceHeading";
import {
  formatHour,
  formatHour24,
  formatMeters,
  formatNumber,
  formatPercent,
  formatSignedMeters,
  formatWind,
  placeTitle,
} from "@/weather/format";
import { compassFrom } from "@/weather/heading";
import { aqiKey, moonKey, t } from "@/weather/i18n";
import { useWeather } from "@/weather/store";
import type { Lang, Place, PressureUnit, WeatherBundle, WindUnit } from "@/weather/types";

export function DetailCards({
  bundle,
  place,
  lang,
  now,
}: {
  bundle: WeatherBundle;
  place: Place;
  lang: Lang;
  now: number;
}) {
  const day = bundle.daily[0];
  const rise = day?.sunrise ?? now;
  const set = day?.sunset ?? now;
  const hour = nearestHour(bundle, now);
  const uv = hour?.uv ?? 0;
  const aqi = bundle.air?.aqi ?? null;
  const dust = bundle.air?.dust ?? null;
  const moon = moonState(now);
  const lunar = moonRiseSet(place.lat, place.lon, now);
  const past = pressureHoursAgo(bundle, now, 3);
  const trend = pressureTrend(pressureDelta(bundle.current.pressure, past));
  const coastal = bundle.marine?.coastal === true;
  const pressureUnit = useWeather((s) => s.prefs.pressure);

  return (
    <div className="mt-3 space-y-3">
      <article className="wx-card grid grid-cols-3 divide-x divide-line py-4 text-center rtl:divide-x-reverse">
        <Stat icon={<Droplets className="size-4" />} label={t(lang, "humidity")} value={formatPercent(bundle.current.humidity, lang)} />
        <Stat icon={<SunMedium className="size-4" />} label={t(lang, "uv")} value={formatNumber(uv, lang, 1)} />
        <Stat
          icon={<Leaf className="size-4" />}
          label={t(lang, "aqi")}
          value={aqi == null ? "—" : formatNumber(aqi, lang, 0)}
          hint={aqi == null ? undefined : t(lang, aqiKey(aqi))}
          accentValue
        />
      </article>

      <article className="wx-card px-3 py-2" dir="ltr">
        <SunArc progress={sunProgress(now, rise, set)} />
        <div className="grid grid-cols-2 px-5 text-center text-fg">
          <div>
            <Sunrise className="mx-auto size-4" />
            <p className="fig mt-0.5">{formatHour24(rise, bundle.timezone)}</p>
          </div>
          <div>
            <Sunset className="mx-auto size-4" />
            <p className="fig mt-0.5">{formatHour24(set, bundle.timezone)}</p>
          </div>
        </div>
      </article>

      <article className="wx-card flex items-center gap-2.5 px-3 py-2">
        <MoonDisc phase={moon.frac} sizeClass="size-14 shrink-0" shadeId="card" />
        <div className="min-w-0 flex-1 text-start">
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold leading-snug">
            <span className="text-fg">{t(lang, moonKey(moon.frac))}</span>
            <span className="font-bold text-accent">
              {t(lang, "illum")} {formatPercent(moon.illum * 100, lang)}
            </span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fg">
            <span className="inline-flex items-center gap-1">
              <Sunrise className="size-3.5 shrink-0" />
              <span className="fig">{lunar.rise ? formatHour24(lunar.rise, bundle.timezone) : "—:—"}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Sunset className="size-3.5 shrink-0" />
              <span className="fig">{lunar.set ? formatHour24(lunar.set, bundle.timezone) : "—:—"}</span>
            </span>
          </p>
        </div>
      </article>

      <div className="grid grid-cols-2 gap-3">
        <article className="wx-card px-3 py-3 text-center">
          <p className="inline-flex items-center gap-1 text-sm text-muted">
            <Gauge className="size-4" />
            {t(lang, "pressure")}
          </p>
          <p className="text-sm text-fg">{t(lang, trend)}</p>
          <PressureGauge hpa={bundle.current.pressure} unit={pressureUnit} lang={lang} />
        </article>
        <article className="wx-card flex flex-col px-3 py-3 text-center">
          <p className="inline-flex items-center justify-center gap-1 text-sm text-muted">
            <Eye className="size-4" />
            {t(lang, "visibility")}
          </p>
          <p className="text-sm text-fg">
            {bundle.current.visibility >= 16000 ? t(lang, "unlimited") : t(lang, "limited")}
          </p>
          <p className="fig mt-auto pt-3 text-fg">{formatKm(bundle.current.visibility, lang)}</p>
          <p className="mt-2 text-sm text-muted">
            {t(lang, "dust")} {dust == null ? "—" : formatNumber(dust, lang, 0)} {t(lang, "perM3")}
          </p>
        </article>
      </div>

      {coastal ? <TideCard bundle={bundle} place={place} lang={lang} now={now} /> : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  accentValue,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  accentValue?: boolean;
}) {
  return (
    <div className="min-w-0 px-2">
      <div className="flex justify-center text-accent">{icon}</div>
      <p className="mt-1 text-sm font-semibold leading-tight text-fg">{label}</p>
      <p className={`mt-0.5 leading-none ${accentValue ? "text-accent" : "text-fg"}`}>
        <span className="fig">{value}</span>
        {hint ? <span className="fig ms-1">{hint}</span> : null}
      </p>
    </div>
  );
}

function formatKm(meters: number, lang: Lang): string {
  return `${formatNumber(meters / 1000, lang, 1)} ${t(lang, "km")}`;
}

function nearestHour(bundle: WeatherBundle, now: number) {
  let best = bundle.hourly[0];
  let dist = Infinity;
  for (const row of bundle.hourly) {
    const d = Math.abs(row.t - now);
    if (d < dist) {
      dist = d;
      best = row;
    }
  }
  return best;
}

function pressureHoursAgo(bundle: WeatherBundle, now: number, hours: number): number | null {
  const target = now - hours * 3_600_000;
  let best: number | null = null;
  let dist = Infinity;
  for (const row of bundle.hourly) {
    const d = Math.abs(row.t - target);
    if (row.t <= now && d < dist) {
      dist = d;
      best = row.pressure;
    }
  }
  return best;
}

/** One sensor-backed compass: red points north, turquoise points to the Kaaba. */
/** Single compass rose with two independently positioned, sensor-synchronised bearings. */
export function QiblaCard({
  lat, lon, reading, lang, wind, windFrom, windUnit,
}: {
  lat: number;
  lon: number;
  reading: CompassReading;
  lang: Lang;
  wind: number;
  windFrom: number;
  windUnit: WindUnit;
}) {
  const bearing = qiblaBearing(lat, lon);
  const { heading, accuracy, trueNorth } = reading;
  const northOnScreen = heading == null ? 0 : -heading;
  const qiblaOnScreen = bearing == null ? null : heading == null ? bearing : relativeQiblaDirection(bearing, heading);
  const ar = lang === "ar";
  const confidence = heading == null ? (ar ? "البوصلة غير متاحة" : "Sensor unavailable")
    : !trueNorth ? (ar ? "الشمال المغناطيسي/غير مُصحّح" : "Magnetic/uncorrected north")
    : accuracy === "low" ? (ar ? "المستشعر يحتاج إلى معايرة" : "Calibrate compass sensor")
    : accuracy === "medium" ? (ar ? "دقة المستشعر متوسطة" : "Medium sensor accuracy")
    : accuracy === "high" ? (ar ? "إشارة مستشعر جيدة" : "Good sensor signal")
    : (ar ? "دقة المستشعر غير معروفة" : "Sensor accuracy unknown");
  return (
    <article className="wx-card flex items-center gap-3 px-3 py-3.5">
      <svg className="size-[8.2rem] shrink-0 text-fg" viewBox="0 0 160 160" role="img"
        aria-label={ar ? "بوصلة واحدة للشمال والقبلة مع مستوى دقة المستشعر" : "Combined north and Qibla compass"}>
        <circle cx="80" cy="80" r="75" fill="currentColor" fillOpacity="0.035" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.1" />
        <circle cx="80" cy="80" r="67" fill="none" stroke="currentColor" strokeOpacity="0.26" strokeWidth="1.2" />
        <g transform={`rotate(${northOnScreen} 80 80)`}>
          {Array.from({ length: 72 }, (_, i) => (
            <line key={i} x1="80" y1="14" x2="80" y2={i % 18 === 0 ? 25 : i % 9 === 0 ? 23 : i % 3 === 0 ? 21 : 18}
              stroke="currentColor" strokeWidth={i % 18 === 0 ? 1.7 : 0.85}
              strokeOpacity={i % 3 === 0 ? 0.6 : 0.3} transform={`rotate(${i * 5} 80 80)`} />
          ))}
          {(["N", "E", "S", "W"] as const).map((label, i) => (
            <text key={label} x="80" y="39" textAnchor="middle" fontSize="12" fontWeight="700"
              fill={i === 0 ? "var(--color-danger)" : "currentColor"}
              transform={`rotate(${i * 90} 80 80) rotate(${-i * 90} 80 35)`}>{label}</text>
          ))}
          <path d="M80 11 L86 50 L80 44 L74 50 Z" fill="var(--color-danger)" />
        </g>
        {qiblaOnScreen != null ? (
          <g transform={`rotate(${qiblaOnScreen} 80 80)`}>
            <path d="M80 9 L95 87 L80 74 L65 87 Z" fill="var(--color-accent)" stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.8" />
            {/* Small vector Kaaba drawn in the Qibla arrow: gold band and dark cuboid. */}
            <g transform="translate(80 49)">
              <path d="M-9 -9 L0 -13 L9 -9 L0 -4 Z" fill="#44413d" />
              <path d="M-9 -9 L0 -4 L0 9 L-9 4 Z" fill="#171717" />
              <path d="M0 -4 L9 -9 L9 4 L0 9 Z" fill="#090909" />
              <path d="M-9 -3 L0 1 L9 -3 L9 0 L0 4 L-9 0 Z" fill="#e3b85b" />
            </g>
          </g>
        ) : null}
        <circle cx="80" cy="80" r="5" fill="currentColor" stroke="var(--color-accent)" strokeWidth="1.5" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{ar ? "بوصلة الشمال والقبلة" : "North & Qibla"}</p>
        <p className="fig mt-1 text-fg">
          <span style={{ color: "var(--color-danger)" }}>{ar ? "الشمال" : "North"}</span>
          <span className="ms-1" dir="ltr">{heading == null ? "—" : `${formatNumber(heading, lang, 0)}°`}</span>
        </p>
        <p className="fig text-fg">
          <span className="text-accent">{ar ? "القبلة" : "Qibla"}</span>
          <span className="ms-1" dir="ltr">{bearing == null ? "—" : `${formatNumber(bearing, lang, 1)}°`}</span>
        </p>
        <p className="mt-1 text-[0.7rem] leading-snug text-muted">{confidence}</p>
        {heading != null && (!trueNorth || accuracy === "low") ? (
          <p className="mt-0.5 text-[0.65rem] text-muted">
            {ar ? "أبعد الهاتف عن المعادن وحرّكه بشكل 8 لمعايرة المستشعر" : "Move away from metal; make a figure-eight motion"}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-fg">
          {t(lang, "wind")} {formatWind(wind, windUnit, lang)}
          <span className="font-semibold text-accent"> · {compassFrom(windFrom, lang)}</span>
        </p>
      </div>
    </article>
  );
}

function SunArc({ progress }: { progress: number }) {
  const p = Math.max(0, Math.min(1, progress));
  const x0 = 22;
  const y0 = 50;
  const cX = 168;
  const cY = 10;
  const x1 = 300;
  const y1 = 50;
  const u = 1 - p;
  const x = u * u * x0 + 2 * u * p * cX + p * p * x1;
  const y = u * u * y0 + 2 * u * p * cY + p * p * y1;
  const qx = u * x0 + p * cX;
  const qy = u * y0 + p * cY;
  return (
    <svg viewBox="0 0 320 62" className="sun-arc h-10 w-full">
      <path d={`M ${x0} ${y0} Q ${cX} ${cY} ${x1} ${y1}`} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2.6" strokeLinecap="round" />
      {p > 0.02 ? (
        <path d={`M ${x0} ${y0} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke="#f0b429" strokeWidth="3.2" strokeLinecap="round" />
      ) : null}
      <circle cx={x} cy={y} r="13" fill="#ffd15a" opacity="0.5" />
      <circle cx={x} cy={y} r="6.5" fill="#ffe7a4" stroke="#f0a020" strokeWidth="1.1" />
    </svg>
  );
}

function PressureGauge({ hpa, unit, lang }: { hpa: number; unit: PressureUnit; lang: Lang }) {
  const min = unit === "inhg" ? 28.9 : 980;
  const max = unit === "inhg" ? 30.9 : 1048;
  const value = unit === "inhg" ? hpa / 33.8638866667 : hpa;
  const p = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = 36;
  const c = 2 * Math.PI * r;
  const arc = c * 0.72;
  return (
    <div className="relative mx-auto mt-2 h-24 w-28">
      <svg viewBox="0 0 100 78" className="h-full w-full">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="8"
          strokeDasharray={`${arc} ${c}`}
          strokeLinecap="round"
          transform="rotate(140 50 50)"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="8"
          strokeDasharray={`${arc * p} ${c}`}
          strokeLinecap="round"
          transform="rotate(140 50 50)"
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="fig text-fg">{formatNumber(value, lang, unit === "inhg" ? 2 : 1)}</p>
        <p className="text-xs text-muted">{unit === "inhg" ? t(lang, "inhg") : t(lang, "mb")}</p>
      </div>
    </div>
  );
}

function TideCard({
  bundle,
  place,
  lang,
  now,
}: {
  bundle: WeatherBundle;
  place: Place;
  lang: Lang;
  now: number;
}) {
  const tide = tideForecast(place.lat, place.lon, now);
  const wave = bundle.marine?.wave;
  const pts = tide.points;
  const levels = pts.map((p) => p.level);
  const min = Math.min(...levels, 0);
  const max = Math.max(...levels, 0.2);
  const w = 320;
  const h = 72;
  const coords = pts.map((p, i) => {
    const x = pts.length < 2 ? 0 : (i / (pts.length - 1)) * w;
    const y = h - 8 - ((p.level - min) / (max - min || 1)) * (h - 16);
    return { x, y, ...p };
  });
  const d = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const nowX = coords.reduce((best, p) => (Math.abs(p.t - now) < Math.abs(best.t - now) ? p : best), coords[0]!);

  return (
    <article className="wx-card px-4 py-4">
      <div className="text-end">
        <h2 className="text-sm font-semibold text-fg">{t(lang, "tide")}</h2>
        <p className="text-sm text-muted">{placeTitle(place, lang)}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <TideStat label={t(lang, "nextHigh")} time={tide.nextHigh ? formatHour24(tide.nextHigh.t, bundle.timezone) : "—"} sub={tide.nextHigh ? formatSignedMeters(tide.nextHigh.level, lang) : "—"} />
        <TideStat label={t(lang, "nextLow")} time={tide.nextLow ? formatHour24(tide.nextLow.t, bundle.timezone) : "—"} sub={tide.nextLow ? formatSignedMeters(tide.nextLow.level, lang) : "—"} />
        <TideStat label={t(lang, "wave")} time={wave == null ? "—" : formatMeters(wave, lang, 1)} sub={t(lang, "now")} />
      </div>
      <div dir="ltr">
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-16 w-full" role="img" aria-label={t(lang, "tide")}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          {nowX ? <line x1={nowX.x} x2={nowX.x} y1="4" y2={h} stroke="var(--color-accent)" strokeWidth="2" /> : null}
          {coords
            .filter((p) => {
              const prev = coords[Math.max(0, coords.indexOf(p) - 1)];
              const next = coords[Math.min(coords.length - 1, coords.indexOf(p) + 1)];
              if (!prev || !next || prev === p || next === p) return false;
              return (p.level >= prev.level && p.level >= next.level) || (p.level <= prev.level && p.level <= next.level);
            })
            .filter((_, i) => i % 2 === 0)
            .slice(0, 4)
            .map((p) => (
              <circle key={p.t} cx={p.x} cy={p.y} r="3.2" fill="currentColor" />
            ))}
        </svg>
      </div>
      <ul className="mt-2 space-y-1">
        {tide.events.map((ev) => (
          <li key={`${ev.kind}-${ev.t}`} className="flex items-center justify-between text-sm">
            <span className="text-muted">{ev.kind === "high" ? t(lang, "tideHigh") : t(lang, "tideLow")}</span>
            <span className="text-fg">
              {formatSignedMeters(ev.level, lang)} · {formatHour(ev.t, bundle.timezone, lang)}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function TideStat({ label, time, sub }: { label: string; time: string; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="fig text-fg">{time}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

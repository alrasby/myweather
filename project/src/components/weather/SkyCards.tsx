import { Droplets, Eye, Gauge, Leaf, SunMedium, Sunrise, Sunset } from "lucide-react";
import type { ReactNode } from "react";
import { MoonDisc } from "@/components/weather/SkyBackdrop";
import { moonRiseSet, moonState, pressureDelta, pressureTrend, sunProgress } from "@/weather/astro";
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
import { useDeviceHeading } from "@/weather/deviceHeading";
import { compassFrom } from "@/weather/heading";
import { qiblaBearing, relativeQiblaAngle } from "@/weather/qibla";
import { shouldDisplayTideCard } from "@/weather/coastalMarine";
import { marineTideForecast } from "@/weather/marineTides";
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
  const coastal = shouldDisplayTideCard(bundle.marine);
  const heading = useDeviceHeading();
  const lastKnownLocation = useWeather((s) => s.here);
  const qiblaLocation = lastKnownLocation ?? place;
  const windUnit = useWeather((s) => s.prefs.wind);
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

      <CompassCard lang={lang} wind={bundle.current.wind} windFrom={bundle.current.dir} windUnit={windUnit} heading={heading} />
      <QiblaCard lang={lang} place={qiblaLocation} heading={heading} isLastKnownLocation={lastKnownLocation !== null} />

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

function CompassCard({
  lang,
  wind,
  windFrom,
  windUnit,
  heading,
}: {
  lang: Lang;
  wind: number;
  windFrom: number;
  windUnit: WindUnit;
  heading: number | null;
}) {
  return (
    <article className="wx-card flex items-center gap-3 px-4 py-3.5">
      <Compass heading={heading} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{t(lang, "compass")}</p>
        <p className="fig mt-0.5 text-fg">
          {heading == null ? "—" : `${compassFrom(heading, lang)} ${formatNumber(heading, lang, 0)}°`}
        </p>
        <p className="mt-0.5 text-sm text-fg">
          {t(lang, "wind")} {formatWind(wind, windUnit, lang)}
          <span className="font-bold text-accent"> · {compassFrom(windFrom, lang)}</span>
        </p>
      </div>
    </article>
  );
}

/** True-north great-circle bearing. Physical sensor readings can be
 * magnetic/un-calibrated: never promise 100% device compass precision. */
function QiblaCard({ lang, place, heading, isLastKnownLocation }: {
  lang: Lang;
  place: Place;
  heading: number | null;
  isLastKnownLocation: boolean;
}) {
  const bearing = qiblaBearing(place.lat, place.lon);
  const relative = bearing === null || heading === null ? null : relativeQiblaAngle(bearing, heading);
  const arabic = lang === "ar";
  return (
    <article className="wx-card flex items-center gap-3 px-4 py-3.5" aria-label={arabic ? "اتجاه القبلة" : "Qibla direction"}>
      <svg viewBox="0 0 96 96" className="size-20 shrink-0 text-fg" role="img"
        aria-label={arabic ? "بوصلة القبلة" : "Qibla compass"}>
        <circle cx="48" cy="48" r="43" stroke="currentColor" strokeOpacity=".3" strokeWidth="1.6" fill="none" />
        <circle cx="48" cy="48" r="34" stroke="currentColor" strokeOpacity=".15" strokeWidth="1" fill="none" />
        <g transform={`rotate(${heading === null ? 0 : -heading} 48 48)`}>
          <text x="48" y="17" textAnchor="middle" fontSize="9" fill="currentColor">N</text>
          <text x="78" y="51" textAnchor="middle" fontSize="9" fill="currentColor">E</text>
          <text x="48" y="84" textAnchor="middle" fontSize="9" fill="currentColor">S</text>
          <text x="18" y="51" textAnchor="middle" fontSize="9" fill="currentColor">W</text>
        </g>
        {relative !== null ? (
          <g transform={`rotate(${relative} 48 48)`}>
            <path d="M48 20 L57 56 L48 49 L39 56 Z" fill="#e6a322" stroke="currentColor" strokeWidth=".6" />
            <path d="M48 49 L42 68 L48 62 L54 68 Z" fill="currentColor" opacity=".24" />
          </g>
        ) : (
          <text x="48" y="54" textAnchor="middle" fontSize="18" fill="#e6a322">✦</text>
        )}
        <circle cx="48" cy="48" r="3.5" fill="currentColor" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{arabic ? "اتجاه القبلة" : "Qibla direction"}</p>
        <p className="text-[11px] text-muted">{isLastKnownLocation
          ? (arabic ? "بحسب آخر موقع محفوظ للجهاز" : "Based on last saved device location")
          : placeTitle(place, lang)}</p>
        <p className="fig mt-1 text-fg">
          {bearing === null ? "—" : `${formatNumber(bearing, lang, 1)}°`}
          <span className="ms-1 text-xs text-muted">{arabic ? "من الشمال الحقيقي" : "from true north"}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          {relative === null
            ? (arabic ? "لا تتوفر قراءة البوصلة؛ الزاوية الجغرافية ظاهرة أعلاه." : "Device heading unavailable; geographic bearing is shown.")
            : (arabic ? "وجّه أعلى الهاتف مع السهم، وعاير البوصلة بعيدًا عن المعادن." : "Align the top of your phone with the arrow; calibrate away from metal.")}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          {arabic ? "دقة السهم تعتمد على المستشعر ومعايرته وتصحيح الشمال المغناطيسي." : "Pointer accuracy depends on sensor calibration and magnetic declination."}
        </p>
      </div>
    </article>
  );
}

function Compass({ heading }: { heading: number | null }) {
  const rose = heading == null ? 0 : -heading;
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  return (
    <svg viewBox="0 0 96 96" className="size-16 shrink-0 text-fg" aria-hidden="true">
      <circle cx="48" cy="48" r="44" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" />
      <g transform={`rotate(${rose} 48 48)`}>
        {ticks.map((a) => (
          <line
            key={a}
            x1="48"
            y1={a % 90 === 0 ? 8 : a % 30 === 0 ? 9 : 11}
            x2="48"
            y2={a % 30 === 0 ? 15 : 13}
            stroke="currentColor"
            strokeOpacity={a % 90 === 0 ? 0.9 : 0.45}
            strokeWidth={a % 90 === 0 ? 1.6 : 1}
            transform={`rotate(${a} 48 48)`}
          />
        ))}
        <text x="48" y="22" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-danger)">N</text>
        <text x="78" y="51" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">E</text>
        <text x="48" y="84" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">S</text>
        <text x="18" y="51" textAnchor="middle" fontSize="9" fontWeight="600" fill="currentColor">W</text>
      </g>
      <polygon points="48,13 53,46 48,42 43,46" fill="var(--color-danger)" />
      <polygon points="48,78 44,50 48,54 52,50" fill="currentColor" opacity="0.28" />
      <circle cx="48" cy="48" r="3.2" fill="#e6a322" stroke="#fff" strokeWidth="0.6" />
    </svg>
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
  const tide = marineTideForecast(bundle.marine?.tides ?? [], now);
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
  const nowX = coords.length ? coords.reduce((best, p) => (Math.abs(p.t - now) < Math.abs(best.t - now) ? p : best), coords[0]!) : null;

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
      <p className="mt-2 text-[11px] text-muted">{lang === "ar"
        ? "توقعات مد وجزر من نموذج بحري تقريبي، وليست مرجعًا للملاحة."
        : "Approximate marine model tide forecast; not for navigation."}</p>
      {pts.length ? <div dir="ltr">
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
      </div> : <p className="mt-3 text-center text-xs text-muted">{lang === "ar"
        ? "بيانات المد والجزر غير متاحة حاليًا"
        : "Tide model data is currently unavailable"}</p>}
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

import { Droplets, Eye, Gauge, Leaf, RefreshCw, SunMedium, Sunrise, Sunset } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MoonDisc } from "@/components/weather/SkyBackdrop";
import { moonRiseSet, moonState, pressureDelta, pressureTrend, sunProgress } from "@/weather/astro";
import { hasDisplayableCoastalTide, modelTideForecast } from "@/weather/marineTides";
import { fetchEot20Forecast, isEot20GatewayEnabled, type Eot20Forecast } from "@/weather/eot20TideClient";
import { fetchOpenWatersTide, type OpenWatersTideForecast } from "@/weather/openWatersTideClient";
import { coastalDistanceKm, COASTAL_CITY_MAX_KM } from "@/weather/coastline";
import { qiblaBearing, relativeQiblaDirection } from "@/weather/qibla";
import type { CompassReading } from "@/weather/deviceHeading";
import {
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
import type { Lang, Place, PressureUnit, WeatherBundle } from "@/weather/types";

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
  const lunar = moonRiseSet(place.lat, place.lon, now, bundle.timezone);
  const past = pressureHoursAgo(bundle, now, 3);
  const trend = pressureTrend(pressureDelta(bundle.current.pressure, past));
  // The global PyFES path is independent of the marine API. A coastal city
  // must still receive a genuine global astronomical result when Open-Meteo
  // has no matching sea-level grid. Never request on unverified inland places.
  const tideHorizon = Math.floor(now / (6 * 3600000));
  const tideKey = `${place.lat}:${place.lon}:${tideHorizon}`;
  const [tideState, setTideState] = useState<{key:string;data:Eot20Forecast|OpenWatersTideForecast}|null>(null);
  useEffect(() => {
    if (!isEot20GatewayEnabled()) return;
    const controller = new AbortController();
    void coastalDistanceKm(place.lat, place.lon).then(async (km) => {
      if (controller.signal.aborted || km > COASTAL_CITY_MAX_KM) return;
      const eot = isEot20GatewayEnabled()
        ? await fetchEot20Forecast(place.lat, place.lon, now, controller.signal) : null;
      if (controller.signal.aborted) return;
      // Prefer the atlas-backed physical model if it is truly deployed. In
      // ordinary free builds use verified nearby station harmonics instead.
      const actual = eot ?? await fetchOpenWatersTide(place.lat, place.lon, now, controller.signal);
      if (actual && !controller.signal.aborted) setTideState({key:tideKey,data:actual});
    }).catch(() => { /* preserve attributed Marine fallback on any failure */ });
    return () => controller.abort();
  }, [tideKey, place.lat, place.lon]);
  const astronomicalTide = tideState?.key === tideKey ? tideState.data : null;
  const showTides = (bundle.marineVersion === 3 &&
    hasDisplayableCoastalTide(bundle.marine, now)) || astronomicalTide !== null;
  const pressureUnit = useWeather((s) => s.prefs.pressure);
  const windUnit = useWeather((s) => s.prefs.wind);

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
              <span className="fig" title={lunar.rise == null ? (lang === "ar" ? "لا يوجد شروق محسوب ضمن اليوم المحلي" : "No computed rise on this local date") : undefined}>{lunar.rise != null ? formatHour24(lunar.rise, bundle.timezone) : "—:—"}</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Sunset className="size-3.5 shrink-0" />
              <span className="fig" title={lunar.set == null ? (lang === "ar" ? "لا يوجد غروب محسوب ضمن اليوم المحلي" : "No computed set on this local date") : undefined}>{lunar.set != null ? formatHour24(lunar.set, bundle.timezone) : "—:—"}</span>
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
          <p className="fig mt-1 font-semibold text-fg">{formatKm(bundle.current.visibility, lang)}</p>
          <p className="mt-1 text-sm text-muted">
            {t(lang, "dust")} {dust == null ? "—" : formatNumber(dust, lang, 0)} {t(lang, "perM3")}
          </p>
          <p className="mt-2 text-[0.72rem] leading-snug text-fg">
            {t(lang, "wind")} {formatWind(bundle.current.wind, windUnit, lang)}
            <span className="font-semibold text-accent"> · {compassFrom(bundle.current.dir, lang)}</span>
          </p>
        </article>
      </div>

      {showTides ? <TideCard bundle={bundle} place={place} lang={lang} now={now} astronomicalTide={astronomicalTide} /> : null}
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
  lat, lon, reading, lang, locating, onLocate,
}: {
  lat: number;
  lon: number;
  reading: CompassReading;
  lang: Lang;
  locating: boolean;
  onLocate: () => void;
}) {
  const bearing = qiblaBearing(lat, lon);
  const { heading } = reading;
  const northOnScreen = heading == null ? 0 : -heading;
  const qiblaOnScreen = bearing == null ? null : heading == null ? bearing : relativeQiblaDirection(bearing, heading);
  const ar = lang === "ar";
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
          {([
            { label: "N", x: 80, y: 36 },
            { label: "E", x: 125, y: 84 },
            { label: "S", x: 80, y: 132 },
            { label: "W", x: 35, y: 84 },
          ] as const).map(({ label, x, y }) => (
            <text key={label} x={x} y={y} textAnchor="middle" fontSize="12" fontWeight="700"
              fill={label === "N" ? "var(--color-danger)" : "currentColor"}
              transform={`rotate(${-northOnScreen} ${x} ${y})`}>{label}</text>
          ))}
          <path d="M80 43 L86 69 L80 63 L74 69 Z" fill="var(--color-danger)" />
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
        <button type="button" className="wx-qibla-refresh mt-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-3 py-1.5 text-[0.72rem] font-semibold text-accent disabled:opacity-65"
          onClick={onLocate} disabled={locating} aria-busy={locating}>
          <RefreshCw aria-hidden="true" className={`size-3.5 shrink-0 ${locating ? "animate-spin" : ""}`} />
          <span>{ar ? "تحديث موقعي للقبلة" : "Update my Qibla location"}</span>
        </button>
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
  astronomicalTide,
}: {
  bundle: WeatherBundle;
  place: Place;
  lang: Lang;
  now: number;
  astronomicalTide: Eot20Forecast | OpenWatersTideForecast | null;
}) {
  const tidePoints = bundle.marine?.tide?.points ?? null;
  const eot = astronomicalTide?.source === "EOT20" ? astronomicalTide : null;
  const station = astronomicalTide?.source === "OPEN_WATERS_STATION" ? astronomicalTide : null;
  const rawTide = modelTideForecast(tidePoints, now);
  const eotEvents = astronomicalTide?.extrema.map(({kind,t,levelM}) => ({kind,t,level:levelM})) ?? [];
  const tide = astronomicalTide ? {
    ...rawTide,
    points: astronomicalTide.points.filter((p) => p.t >= now - 3 * 3600000 &&
      p.t <= now + 24 * 3600000).map(({t,levelM}) => ({t,level:levelM})),
    nextHigh: eotEvents.find((ev) => ev.kind === "high" && ev.t >= now) ?? null,
    nextLow: eotEvents.find((ev) => ev.kind === "low" && ev.t >= now) ?? null,
  } : rawTide;
  const wave = bundle.marine?.wave;
  const pts = tide.points;
  const levels = pts.map((p) => p.level);
  const min = Math.min(...levels, 0);
  const max = Math.max(...levels, 0.2);
  const w = 320;
  const h = 72;
  // Plot real UTC sample spacing, not array indices: rejected/absent hours
  // must not compress the time axis. The now-marker moves continuously rather
  // than jumping to the nearest model hour.
  const start = pts[0]?.t ?? now;
  const end = pts[pts.length - 1]?.t ?? start;
  const span = Math.max(1, end - start);
  const coords = pts.map((p) => {
    const x = ((p.t - start) / span) * w;
    const y = h - 8 - ((p.level - min) / (max - min || 1)) * (h - 16);
    return { x, y, ...p };
  });
  const d = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const nowX = coords.length > 1 ? Math.max(0, Math.min(w, ((now - start) / span) * w)) : null;

  return (
    <article className="wx-card px-4 py-4">
      <div className="text-end">
        <h2 className="text-sm font-semibold text-fg">{t(lang, "tide")}</h2>
        <p className="text-sm text-muted">{placeTitle(place, lang)}</p>
        {/* One short, readable source-aware status. Additional attribution
            remains in the linked label/title; no second source paragraph. */}
        <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.66rem] leading-5 text-muted">
          {eot ? (
            <a href="https://doi.org/10.17882/79489" target="_blank" rel="noopener noreferrer"
              title="DGFI-TUM EOT20 · Hart-Davis 2021 · CC BY 4.0 · Not for navigation">
              {lang === "ar" ? "المد الفلكي من PyFES / EOT20" : "Astronomical tide · PyFES / EOT20"}
            </a>
          ) : station ? (
            <a href="https://openwaters.io/api/tides/" target="_blank" rel="noopener noreferrer"
              title={station.attribution + " · " + station.license + " · " + station.datum + " · Not for navigation"}>
              {lang === "ar" ? `مد فلكي: ${station.stationName} (${formatNumber(station.distanceKm,lang,0)} كم)` :
                `Station tide: ${station.stationName} (${station.distanceKm.toFixed(0)} km)`}
            </a>
          ) : (
            <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank"
              rel="noopener noreferrer" title="Open-Meteo Marine · Estimated modelled sea level (MSL) · Not for navigation">
              {lang === "ar" ? "توقيت المد والجزر تقديري من نموذج سطح البحر" :
                "Estimated tide timing · Marine sea-level model"}
            </a>
          )}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {/* These are estimated sea-level extrema from real provider samples,
              NOT astronomical gauge-calibrated tide predictions. */}
          <TideStat label={t(lang, "nextHigh")} time={tide.nextHigh ? formatHour24(tide.nextHigh.t, bundle.timezone) : "—"} sub={tide.nextHigh ? `${lang === "ar" ? astronomicalTide ? "فلكي" : "تقديري" : astronomicalTide ? "Model" : "Est."} · ${formatSignedMeters(tide.nextHigh.level, lang)}` : lang === "ar" ? "لا توجد ذروة واضحة" : "No clear peak"} />
          <TideStat label={t(lang, "nextLow")} time={tide.nextLow ? formatHour24(tide.nextLow.t, bundle.timezone) : "—"} sub={tide.nextLow ? `${lang === "ar" ? astronomicalTide ? "فلكي" : "تقديري" : astronomicalTide ? "Model" : "Est."} · ${formatSignedMeters(tide.nextLow.level, lang)}` : lang === "ar" ? "لا يوجد انخفاض واضح" : "No clear trough"} />
          <TideStat label={t(lang, "wave")} time={wave == null ? "—" : formatMeters(wave, lang, 1)} sub={astronomicalTide ? "Open-Meteo Marine" : t(lang, "now")} />
        </div>
      <div dir="ltr">
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-16 w-full" role="img" aria-label={astronomicalTide ? (lang === "ar" ? "منحنى المد والجزر الفلكي" : "Astronomical tide curve") : (lang === "ar" ? "مستوى سطح البحر النموذجي التقديري" : "Estimated modelled sea level")}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          {nowX !== null ? <line x1={nowX} x2={nowX} y1="4" y2={h} stroke="var(--color-accent)" strokeWidth="2" /> : null}
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

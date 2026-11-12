import { ChevronDown, MapPin, SunMedium, Sunrise, Sunset, Thermometer, Umbrella, Wind, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DetailCards, QiblaCard } from "@/components/weather/SkyCards";
import { citySwipeOrder, citySwipeTarget } from "@/weather/citySwipe";
import { useDeviceCompass } from "@/weather/deviceHeading";
import { WeatherIcon } from "@/components/weather/WeatherIcon";
import { placeFromCoords } from "@/weather/api";
import { readBestPosition } from "@/weather/geo";
import {
  dayKey,
  formatDayDate,
  formatDayLabel,
  formatHour24,
  formatNumber,
  formatPercent,
  formatTemp,
  formatWind,
  placeCountry,
  placeTitle,
} from "@/weather/format";
import { t, weatherKey, type CopyKey } from "@/weather/i18n";
import { textBase } from "@/weather/locale";
import { lookupPlace } from "@/weather/placeLookup";
import { pinWeatherAlerts } from "@/weather/pinnedAlerts";
import { suppressCityOnRefresh, visibleWeatherNotices } from "@/weather/alertVisibility";
import { activePlace, useWeather } from "@/weather/store";
import type { DayPoint, HourPoint, Lang, QuietHours, WeatherBundle } from "@/weather/types";

export function HomeScreen({ lang, onOpenPlaces }: { lang: Lang; onOpenPlaces: () => void }) {
  const places = useWeather((s) => s.places);
  const activeId = useWeather((s) => s.activeId);
  const peek = useWeather((s) => s.peek);
  const here = useWeather((s) => s.here);
  const prefs = useWeather((s) => s.prefs);
  const bundle = useWeather((s) => s.bundle);
  const loading = useWeather((s) => s.loading);
  const error = useWeather((s) => s.error);
  const estimated = useWeather((s) => s.estimated);
  const stale = useWeather((s) => s.stale);
  const loadActive = useWeather((s) => s.loadActive);
  const setActive = useWeather((s) => s.setActive);
  const locatePlace = useWeather((s) => s.locatePlace);
  const setHere = useWeather((s) => s.setHere);
  const [compassLocating, setCompassLocating] = useState(false);
  const [qiblaFix, setQiblaFix] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const place = activePlace({ places, activeId, peek });
  // A GPS fix remains a preview, not a saved city. Include it in gesture
  // navigation when distinct from saved locations, without modifying places.
  const gpsPreview = here && !places.some((p) => {
    const dLat = (p.lat - here.lat) * 111;
    const dLon = (p.lon - here.lon) * 111 * Math.cos((p.lat + here.lat) * Math.PI / 360);
    return p.id === here.id || Math.hypot(dLat, dLon) < 0.35;
  }) ? here : null;
  const swipeIds = citySwipeOrder(places.map((p) => p.id), gpsPreview?.id, peek?.id);
  const navigateSwipe = (target: string) => {
    if (places.some((p) => p.id === target)) setActive(target);
    else if (gpsPreview?.id === target) locatePlace(gpsPreview);
    else if (peek?.id === target) locatePlace(peek);
  };
  // Do not silently treat a GPS fix saved in a previous session as current.
  const compassPlace = qiblaFix ?? place;
  // Declination must use the phone's measured position, not an unrelated selected city.
  const reading = useDeviceCompass(qiblaFix?.lat ?? Number.NaN, qiblaFix?.lon ?? Number.NaN);
  const scroller = useRef<HTMLDivElement>(null);
  // The atmospheric sky and the localized hero are separate canvases.
  // Fade BOTH before forecast cards reach the cloud area: neither a fixed
  // backdrop nor a scrolling hero should appear attached to the cards.
  // Scroll updates write one compositor-friendly CSS variable, without
  // React state changes, timers or additional canvas draw calls.
  const syncCloudsWithScroll = () => {
    const top = Math.max(0, scroller.current?.scrollTop ?? 0);
    const t = Math.min(1, top / 96);
    const opacity = 1 - t * t * (3 - 2 * t);
    document.documentElement.style.setProperty("--wx-cloud-scroll-opacity", opacity.toFixed(4));
  };
  useEffect(() => {
    syncCloudsWithScroll();
    return () => {
      document.documentElement.style.removeProperty("--wx-cloud-scroll-opacity");
    };
    // The ref points to the same Home scroll container for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pull = useRef(0);
  const swipeStart = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  const swipeLast = useRef<{ x: number; y: number } | null>(null);
  const [pulling, setPulling] = useState(0);
  const [locating, setLocating] = useState(false);
  const locateGen = useRef(0);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [hideMorning, setHideMorning] = useState(false);
  const [pinnedAlerts, setPinnedAlerts] = useState<Record<string, string[]>>({});
  const [refreshHiddenCities, setRefreshHiddenCities] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem("myweather-alert-refresh-hidden") || "[]");
      return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string").slice(-32) : [];
    } catch { return []; }
  });
  const [dismissed, setDismissed] = useState<string[]>(() => {
    if (typeof sessionStorage === "undefined") return [];
    try {
      const raw = sessionStorage.getItem("myweather-alert-hide");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const now = Date.now();

  const locateCompass = () => {
    if (compassLocating) return;
    setCompassLocating(true);
    void readBestPosition((pos) => {
      setQiblaFix({ lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy });
    }).catch(() => undefined)
      .finally(() => setCompassLocating(false));
  };

  const refresh = () => {
    void loadActive(true);
  };

  const locate = () => {
    if (locating) return;
    setLocating(true);
    const gen = ++locateGen.current;
    let ticket = 0;
    const apply = (pos: { lat: number; lon: number }) => {
      const mine = ++ticket;
      void lookupPlace(pos.lat, pos.lon, textBase()).then((rev) => {
        if (mine !== ticket || gen !== locateGen.current) return;
        const name = rev?.name || `${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}`;
        const next = placeFromCoords(pos.lat, pos.lon, name, rev?.country || "", rev?.admin || "");
        setHere(next);
        locatePlace(next);
      });
    };
    void readBestPosition(apply).finally(() => {
      if (gen === locateGen.current) setLocating(false);
    });
  };

  const alerts = bundle && bundle.placeId === place.id && prefs.alerts && !inQuiet(prefs.quiet, bundle.timezone, now)
    ? buildAlerts(bundle, prefs, lang, now) : [];
  const alertScope = `${place.id}|${lang}`;
  // Pull-to-refresh changes live forecast objects. Keep already displayed
  // alerts pinned to the selected city until the user explicitly dismisses.
  // A new alert may be added; old alerts must not vanish mid-refresh.
  const alertSignature = alerts.join("\\u0001");
  useEffect(() => {
    if (!prefs.alerts || !alerts.length) return;
    setPinnedAlerts((previous) => {
      const present = previous[alertScope] ?? [];
      const merged = pinWeatherAlerts(present, alerts);
      return merged.length === present.length ? previous : { ...previous, [alertScope]: merged };
    });
    // alerts are intentionally represented by their stable joined signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertScope, alertSignature, prefs.alerts]);
  const shownAlerts = visibleWeatherNotices(
    prefs.alerts ? pinnedAlerts[alertScope] ?? alerts : [],
    refreshHiddenCities, place.id, dismissed,
  );
  const hideAlertsAfterPull = () => {
    setRefreshHiddenCities((prev) => {
      if (prev.includes(place.id)) return prev;
      const next = suppressCityOnRefresh(prev, place.id);
      try { sessionStorage.setItem("myweather-alert-refresh-hidden", JSON.stringify(next)); }
      catch { /* session storage may be disabled */ }
      return next;
    });
  };
  const dismissAlert = (key: string) => {
    setDismissed((prev) => {
      const next = prev.includes(key) ? prev : [...prev, key].slice(-40);
      try {
        sessionStorage.setItem("myweather-alert-hide", JSON.stringify(next));
      } catch {
        /* جلسة بلا تخزين */
      }
      return next;
    });
  };
  const morning = bundle && !hideMorning && !inQuiet(prefs.quiet, bundle.timezone, now) && isMorning(prefs.morning, bundle.timezone, now);

  const span = useMemo(() => {
    if (!bundle) return { min: 0, max: 1 };
    const mins = bundle.daily.slice(0, 15).map((d) => d.tmin).filter(Number.isFinite);
    const maxs = bundle.daily.slice(0, 15).map((d) => d.tmax).filter(Number.isFinite);
    return mins.length && maxs.length ? { min: Math.min(...mins), max: Math.max(...maxs) } : { min: 0, max: 1 };
  }, [bundle]);

  return (
    <div
      ref={scroller}
      onScroll={syncCloudsWithScroll}
      style={{ touchAction: "pan-y" }}
      className="h-full overflow-y-auto overscroll-contain px-3 pb-[calc(2.9rem+max(0.65rem,env(safe-area-inset-bottom))+2mm+6px)]"
      onTouchStart={(e) => {
        if (e.touches.length !== 1) {
          swipeStart.current = null;
          swipeLast.current = null;
          pull.current = 0;
          return;
        }
        const touch = e.touches[0]!;
        const target = e.target instanceof Element ? e.target : null;
        // Hourly ribbons, forecast carousel and interactive elements retain
        // their own horizontal gestures. Only saved cities are eligible.
        const nested = target?.closest('header, nav, a, input, textarea, select, [role="slider"], [data-no-city-swipe], .overflow-x-auto, .wx-qibla-refresh');
        swipeStart.current = { x: touch.clientX, y: touch.clientY, eligible: !nested };
        swipeLast.current = { x: touch.clientX, y: touch.clientY };
        pull.current = (scroller.current?.scrollTop ?? 0) <= 0 ? touch.clientY : 0;
      }}
      onTouchMove={(e) => {
        const point = e.touches[0];
        if (!point || !swipeStart.current) return;
        swipeLast.current = { x: point.clientX, y: point.clientY };
        if (!pull.current) return;
        const dx = point.clientX - swipeStart.current.x;
        const dy = point.clientY - swipeStart.current.y;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          setPulling(0);
          return;
        }
        if (dy > 0) setPulling(Math.min(80, dy));
      }}
      onTouchEnd={(e) => {
        // Horizontal city paging must never also trigger vertical refresh.
        const gesture = swipeStart.current;
        const touch = e.changedTouches[0] ?? swipeLast.current;
        const dx = gesture && touch ? touch.clientX - gesture.x : 0;
        const dy = gesture && touch ? touch.clientY - gesture.y : 0;
        const target = gesture?.eligible
          ? citySwipeTarget(swipeIds, activeId, dx, dy, lang === "ar")
          : null;
        if (target) {
          navigateSwipe(target); // Changes view only; never adds GPS to saved cities.
        } else if (pull.current > 0 && dy > 64 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          hideAlertsAfterPull();
          refresh();
        }
        swipeStart.current = null;
        swipeLast.current = null;
        pull.current = 0;
        setPulling(0);
      }}
      onTouchCancel={() => {
        const gesture = swipeStart.current;
        const last = swipeLast.current;
        const target = gesture?.eligible && last
          ? citySwipeTarget(swipeIds, activeId,
              last.x - gesture.x, last.y - gesture.y, lang === "ar")
          : null;
        if (target) navigateSwipe(target);
        swipeStart.current = null;
        swipeLast.current = null;
        pull.current = 0;
        setPulling(0);
      }}
    >
      <header className="sticky top-3 z-30 flex bg-transparent">
        <div className="glass-bar flex min-h-12 max-w-full items-center rounded-full py-1 pe-3.5 ps-1">
          <button
            type="button"
            onClick={locate}
            className="grid size-11 shrink-0 place-items-center rounded-full"
            aria-label={t(lang, "locate")}
          >
            <MapPin className={`size-5 ${locating ? "animate-pulse" : ""}`} />
          </button>
          <button type="button" onClick={onOpenPlaces} className="min-w-0 text-start">
            <span className="block truncate text-base font-semibold leading-tight">{placeTitle(place, lang)}</span>
            <span className="block truncate text-xs leading-tight opacity-80">{placeCountry(place, lang)}</span>
          </button>
        </div>
      </header>

      {shownAlerts.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {shownAlerts.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => dismissAlert(`${place.id}|${item}`)}
              className="glass-bar inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold"
            >
              <span className="truncate">{item}</span>
              <X className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">{t(lang, "close")}</span>
            </button>
          ))}
        </div>
      ) : null}

      {pulling > 16 ? (
        <p className="flex h-6 items-center justify-center text-xs text-on-sky/80">{t(lang, "pull")}</p>
      ) : null}

      {error && !bundle ? (
        <div className="wx-card mt-4 p-5 text-center">
          <p className="text-sm text-muted">{t(lang, "offline")}</p>
          <button type="button" onClick={refresh} className="mt-3 h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink">
            {t(lang, "retry")}
          </button>
        </div>
      ) : null}

      {bundle ? (
        <>
          {morning ? (
            <button type="button" onClick={() => setHideMorning(true)} className="wx-card mb-3 flex w-full items-center justify-between px-4 py-3 text-start">
              <span>
                <span className="block text-sm font-medium text-fg">{t(lang, "morningBody")}</span>
                <span className="block text-sm text-muted">
                  {t(lang, weatherKey(bundle.current.code))} · {formatTemp(bundle.current.temp, prefs.temp, lang)} · {formatWind(bundle.current.wind, prefs.wind, lang)}
                </span>
              </span>
            </button>
          ) : null}

          <div className="temp-under-orb relative z-[1] px-1 text-on-sky" data-sky-hero="">
            <div className="relative z-[1]">
            <div className="flex items-end justify-between gap-3">
              <p className="text-5xl font-medium leading-none tracking-tight">{formatTemp(bundle.current.temp, prefs.temp, lang)}</p>
              <div className="min-w-0 max-w-[54%] pb-0.5 text-end">
                <p className="text-base font-semibold leading-tight">{t(lang, weatherKey(bundle.current.code))}</p>
                <p className="text-sm font-medium leading-tight">
                  {t(lang, "feels")} {formatTemp(bundle.current.feels, prefs.temp, lang)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-start text-sm font-medium" data-sky-anchor="">
              • {t(lang, "hi")} {formatTemp(bundle.daily[0]?.tmax ?? bundle.current.temp, prefs.temp, lang)}
              <span className="ms-3">• {t(lang, "lo")} {formatTemp(bundle.daily[0]?.tmin ?? bundle.current.temp, prefs.temp, lang)}</span>
            </p>
            {estimated && !loading ? (
              <p className="mt-1 text-xs font-medium text-on-sky/75">{t(lang, "estimated")}</p>
            ) : stale && !loading ? (
              <p className="mt-1 text-xs font-medium text-on-sky/75">{t(lang, "stale")}</p>
            ) : loading ? (
              <p className="mt-1 text-xs font-medium text-on-sky/75">{t(lang, "updating")}</p>
            ) : null}
            </div>
          </div>

          <section className="wx-card mt-4 overflow-hidden py-2">
            <HourRibbon bundle={bundle} lang={lang} />
          </section>

          <section className="wx-card wx-daily-card mt-3 overflow-hidden px-2.5 py-3">
            <div className="mb-1 px-1">
              <h2 className="text-base font-semibold text-fg">{t(lang, "daily")}</h2>
            </div>
            <div>
              {bundle.daily.slice(0, 15).map((d) => {
                const open = openDay === d.t;
                return (
                  <div key={d.t} className="wx-daily-row border-b border-line last:border-b-0">
                    <button
                      type="button"
                      className="grid min-h-[3.15rem] w-full min-w-0 items-center gap-x-1 py-1.5 text-start"
                      style={{ gridTemplateColumns: "minmax(0,1.2fr) max-content 1.15rem minmax(2.2rem,1fr) max-content 1rem" }}
                      aria-expanded={open}
                      onClick={() => setOpenDay(open ? null : d.t)}
                    >
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-sm font-medium text-fg">{formatDayLabel(d.t, bundle.timezone, lang, now)}</span>
                        <span className="block truncate text-[0.68rem] text-muted">{formatDayDate(d.t, bundle.timezone, lang)}</span>
                      </span>
                      <span className="text-center leading-tight">
                        <span className="block whitespace-nowrap text-xs font-medium text-fg">{formatPercent(d.pop, lang)}</span>
                        <span className="block whitespace-nowrap text-[0.68rem] text-muted">
                          {formatNumber(d.precip, lang, d.precip >= 10 ? 0 : 1)}
                          {t(lang, "mm")}
                        </span>
                      </span>
                      <WeatherIcon code={d.code} isDay className="size-4 justify-self-center text-accent" />
                      <TempSpan lo={d.tmin} hi={d.tmax} min={span.min} max={span.max} />
                      <bdi dir="ltr" className="whitespace-nowrap text-center text-[0.8rem] font-medium text-fg">
                        {formatTemp(d.tmax, prefs.temp, lang)} / {formatTemp(d.tmin, prefs.temp, lang)}
                      </bdi>
                      <ChevronDown className={`size-4 justify-self-center text-muted transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open ? <div className="wx-daily-reveal"><DayPanel bundle={bundle} day={d} lang={lang} /></div> : null}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mt-3">
            <QiblaCard lat={compassPlace.lat} lon={compassPlace.lon} reading={reading} lang={lang}
              locating={compassLocating} onLocate={locateCompass} />
          </div>
          <DetailCards bundle={bundle} place={place} lang={lang} now={now} />
        </>
      ) : loading ? (
        <div className="mt-6 space-y-3">
          <div className="wx-card h-24 animate-pulse" />
          <div className="wx-card h-36 animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}

function DayPanel({ bundle, day, lang }: { bundle: WeatherBundle; day: DayPoint; lang: Lang }) {
  const temp = useWeather((s) => s.prefs.temp);
  const wind = useWeather((s) => s.prefs.wind);
  const hours = hoursForDay(bundle, day);
  const actualHourlyCount = bundle.hourly.filter((h) => dayKey(h.t, bundle.timezone) === dayKey(day.t, bundle.timezone)).length;
  const hourlyEstimated = actualHourlyCount < 18;
  const warm = hours.reduce<HourPoint | null>((best, h) => (!best || h.temp > best.temp ? h : best), null);
  const gust = hours.reduce((max, h) => Math.max(max, h.gust || h.wind), day.wind);
  const feels = warm?.feels ?? day.tmax;
  const rainy = day.precip >= 0.2 || day.pop >= 40;
  const line = rainy ? "dayRainy" : day.code <= 1 ? "dayClearDry" : "dayCloudyDry";

  return (
    <div className="pb-3">
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {hours.map((h) => (
          <div key={h.t} className="hour-chip flex w-[4.6rem] shrink-0 flex-col items-center gap-0.5 rounded-2xl px-1 py-2.5 text-center">
            <span className="text-xs font-medium text-muted">{hour24(h.t, bundle.timezone)}</span>
            <WeatherIcon code={h.code} isDay={h.isDay} className="size-6 text-accent" />
            <span className="text-sm font-bold leading-none text-fg">{formatTemp(h.temp, temp, lang)}</span>
            <span className="pop-chance text-xs font-semibold">{formatPercent(h.pop, lang)}</span>
            <span className="text-[0.68rem] text-muted">
              {formatNumber(h.precip, lang, 1)} {t(lang, "mm")}
            </span>
            <span className="text-[0.68rem] text-muted">
              {t(lang, "uv")} {formatNumber(h.uv, lang, 0)}
            </span>
          </div>
        ))}
      </div>
      {hourlyEstimated ? (
        <p className="px-1 text-[0.69rem] leading-snug text-muted" role="note">
          {lang === "ar"
            ? "التوزيع الساعي تقديري من بيانات اليوم؛ التفاصيل الساعية ليست توقعات مستقلة من المصدر."
            : "Hourly distribution is estimated from daily values, not independently supplied hourly forecasts."}
        </p>
      ) : null}
      <p className="px-1 py-2 text-sm font-semibold text-fg">{t(lang, line)}</p>
      <div className="grid grid-cols-3 gap-y-4 px-1 text-center">
        <Mini icon={<Wind className="size-5" />} label={t(lang, "wind")} value={formatWind(day.wind, wind, lang)} />
        <Mini icon={<Wind className="size-5" />} label={t(lang, "gusts")} value={formatWind(gust, wind, lang)} />
        <Mini icon={<SunMedium className="size-5" />} label={t(lang, "uv")} value={`${formatNumber(day.uv, lang, 0)} ${t(lang, uvBand(day.uv))}`} />
        <Mini icon={<Sunrise className="size-5" />} label={t(lang, "sunrise")} value={formatHour24(day.sunrise, bundle.timezone)} />
        <Mini icon={<Sunset className="size-5" />} label={t(lang, "sunset")} value={formatHour24(day.sunset, bundle.timezone)} />
        <Mini icon={<Thermometer className="size-5" />} label={t(lang, "feels")} value={formatTemp(feels, temp, lang)} />
      </div>
    </div>
  );
}

function clockHour(ms: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

function tzOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(Number(g.year), Number(g.month) - 1, Number(g.day), Number(g.hour) % 24, Number(g.minute), Number(g.second));
  return asUTC - ms;
}

function zonedHour(key: string, hour: number, timeZone: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, 0, 0);
  const off1 = tzOffsetMs(utcGuess, timeZone);
  let t = utcGuess - off1;
  const off2 = tzOffsetMs(t, timeZone);
  if (off2 !== off1) t = utcGuess - off2;
  return t;
}

function hoursForDay(bundle: WeatherBundle, day: DayPoint): HourPoint[] {
  const zone = bundle.timezone || "UTC";
  const key = dayKey(day.t, zone);
  const real = new Map<number, HourPoint>();
  for (const row of bundle.hourly) {
    if (dayKey(row.t, zone) !== key) continue;
    real.set(clockHour(row.t, zone), row);
  }
  if (real.size >= 18) return [...real.values()].sort((a, b) => a.t - b.t);

  const start = zonedHour(key, 0, zone);
  const rise = (day.sunrise - start) / 3_600_000;
  const set = (day.sunset - start) / 3_600_000;
  const peak = Math.min(16, Math.max((Number.isFinite(rise) ? rise : 6) + 5, 14));
  const weights = Array.from({ length: 24 }, (_, hour) => {
    const x = (hour - 15) / 3.2;
    return Math.exp(-x * x);
  });
  const weightSum = weights.reduce((s, n) => s + n, 0) || 1;
  const out: HourPoint[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hit = real.get(hour);
    if (hit) {
      out.push(hit);
      continue;
    }
    const t = zonedHour(key, hour, zone);
    const temp = diurnalTemp(hour, day.tmin, day.tmax, Number.isFinite(rise) ? rise : 6, peak);
    const daylight = Number.isFinite(day.sunrise) && Number.isFinite(day.sunset) ? t >= day.sunrise && t < day.sunset : hour >= 6 && hour < 18;
    const mid = Number.isFinite(rise) && Number.isFinite(set) ? (rise + set) / 2 : 12;
    const half = Number.isFinite(rise) && Number.isFinite(set) ? Math.max(1, (set - rise) / 2) : 6;
    const uv = daylight ? day.uv * Math.max(0, Math.cos(((hour - mid) / half) * (Math.PI / 2))) : 0;
    const wind = day.wind * (0.42 + 0.58 * weights[hour]);
    const precip = day.precip > 0 ? (day.precip * weights[hour]) / weightSum : 0;
    const pop = day.pop * (0.4 + 0.6 * (weights[hour] / (weights[15] || 1)));
    out.push({
      t,
      temp,
      precip,
      pop: Math.max(0, Math.min(100, pop)),
      code: precip >= 0.2 ? (day.code >= 51 ? day.code : 61) : day.code,
      wind,
      gust: wind * (precip >= 0.2 ? 1.4 : 1.28),
      feels: temp + (temp >= 32 ? 1.4 : temp <= 10 ? -0.6 : 0) - Math.max(0, wind - 10) * 0.04,
      uv,
      isDay: daylight,
      pressure: 0,
    });
  }
  return out;
}

function diurnalTemp(hour: number, tmin: number, tmax: number, rise: number, peak: number): number {
  const warmSpan = ((peak - rise) % 24 + 24) % 24;
  const intoWarm = ((hour - rise) % 24 + 24) % 24;
  if (warmSpan > 0.5 && intoWarm <= warmSpan) {
    const u = intoWarm / warmSpan;
    return tmin + (tmax - tmin) * (0.5 - 0.5 * Math.cos(Math.PI * u));
  }
  const coolSpan = ((rise + 24 - peak) % 24 + 24) % 24 || 24;
  const intoCool = ((hour - peak) % 24 + 24) % 24;
  const u = Math.min(1, intoCool / coolSpan);
  return tmax + (tmin - tmax) * (0.5 - 0.5 * Math.cos(Math.PI * u));
}

function Mini({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 px-1">
      <div className="flex justify-center text-accent">{icon}</div>
      <p className="mt-1 truncate text-xs text-muted">{label}</p>
      <p className="truncate text-sm font-semibold leading-tight text-fg">{value}</p>
    </div>
  );
}

function uvBand(uv: number): CopyKey {
  if (uv < 3) return "bandLow";
  if (uv < 6) return "bandMod";
  if (uv < 8) return "bandHigh";
  return "bandExtreme";
}

function hour24(ms: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === "hour")?.value ?? "00";
  } catch {
    return "00";
  }
}

function clockLabel(ms: number, zone: string): string {
  const raw = formatHour24(ms, zone);
  const [h, m] = raw.split(":");
  return `${(h ?? "0").padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
}

function HourRibbon({ bundle, lang }: { bundle: WeatherBundle; lang: Lang }) {
  const unit = useWeather((s) => s.prefs.temp);
  const day = bundle.daily[0];
  const hours = day ? hoursForDay(bundle, day) : [];
  const scroller = useRef<HTMLDivElement>(null);
  const [col, setCol] = useState(86);
  const dayKeyStamp = day?.t ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      if (w < 80) return;
      const n = w >= 720 ? 8 : 6;
      const next = w / n;
      setCol((prev) => (Math.abs(prev - next) < 0.4 ? prev : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hours.length]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const now = Date.now();
    const nodes = el.querySelectorAll<HTMLElement>("[data-t]");
    let idx = 0;
    nodes.forEach((node, i) => {
      if (Number(node.dataset.t) <= now) idx = i;
    });
    el.scrollLeft = Math.max(0, idx * col);
  }, [dayKeyStamp, hours.length, col]);
  if (!hours.length) return null;

  type Slot = { kind: "hour"; t: number; hour: HourPoint } | { kind: "mark"; t: number; key: "sunrise" | "sunset" };
  const slots: Slot[] = hours.map((hour) => ({ kind: "hour", t: hour.t, hour }));
  const start = hours[0]!.t - 20 * 60_000;
  const end = hours[hours.length - 1]!.t + 20 * 60_000;
  if (day && day.sunrise >= start && day.sunrise <= end) slots.push({ kind: "mark", t: day.sunrise, key: "sunrise" });
  if (day && day.sunset >= start && day.sunset <= end) slots.push({ kind: "mark", t: day.sunset, key: "sunset" });
  slots.sort((a, b) => a.t - b.t);

  const amp = 18;
  const top = 5;
  const labelDy = 18;
  const temps = hours.map((h) => h.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = hi - lo;
  const yOf = (v: number) => (span < 0.4 ? top : top + (1 - (v - lo) / span) * amp);
  const chartH = top + amp + labelDy + 6;
  const indexOf = new Map(slots.map((slot, i) => [slot.kind === "hour" ? slot.hour.t : -1, i]));
  const pts = hours.map((h) => ({
    x: (indexOf.get(h.t) ?? 0) * col + col / 2,
    y: yOf(h.temp),
    temp: h.temp,
    t: h.t,
  }));
  const width = slots.length * col;
  const line = [`0,${pts[0]!.y.toFixed(1)}`, ...pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`), `${width},${pts[pts.length - 1]!.y.toFixed(1)}`].join(" ");

  return (
    <div ref={scroller} className="no-scrollbar snap-x snap-mandatory overflow-x-auto" dir="ltr">
      <div style={{ width }}>
        <div className="flex">
          {slots.map((slot) =>
            slot.kind === "hour" ? (
              <div key={slot.t} data-t={slot.t} className="flex shrink-0 snap-start flex-col items-center gap-0.5 pt-1 text-fg" style={{ width: col }}>
                <span className="whitespace-nowrap text-[0.78rem] font-medium tabular-nums text-muted">{clockLabel(slot.hour.t, bundle.timezone)}</span>
                <WeatherIcon code={slot.hour.code} isDay={slot.hour.isDay} className="size-8 text-accent" />
                <span className="flex items-center gap-0.5 whitespace-nowrap text-[0.7rem] leading-none text-muted">
                  <Umbrella className="size-3.5" strokeWidth={1.7} />
                  {formatPercent(slot.hour.pop, lang)}
                </span>
              </div>
            ) : (
              <div key={`${slot.key}-${slot.t}`} data-t={slot.t} className="flex shrink-0 snap-start flex-col items-center gap-0.5 pt-1 text-accent" style={{ width: col }}>
                <span className="whitespace-nowrap text-[0.78rem] font-medium tabular-nums">{clockLabel(slot.t, bundle.timezone)}</span>
                {slot.key === "sunrise" ? <Sunrise className="size-8" strokeWidth={1.6} /> : <Sunset className="size-8" strokeWidth={1.6} />}
                <span className="whitespace-nowrap text-center text-[0.7rem] font-medium leading-none">{t(lang, slot.key)}</span>
              </div>
            ),
          )}
        </div>
        <svg width={width} height={chartH} className="mt-0.5 block text-fg" role="img" aria-hidden="true">
          <polyline points={line} fill="none" stroke="#e6c15a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => (
            <g key={p.t}>
              <circle cx={p.x} cy={p.y} r="4.6" fill="#fff" stroke="#e6c15a" strokeWidth="1.8" />
              <text
                x={p.x}
                y={p.y + labelDy}
                textAnchor="middle"
                fontSize="15"
                fontWeight="700"
                fill="currentColor"
                fontFamily="Readex Pro, sans-serif"
              >
                {formatTemp(p.temp, unit, lang)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function TempSpan({ lo, hi, min, max }: { lo: number; hi: number; min: number; max: number }) {
  const span = max - min || 1;
  const a = ((Math.min(lo, hi) - min) / span) * 100;
  const b = ((Math.max(lo, hi) - min) / span) * 100;
  return (
    <span className="temp-range" dir="ltr" aria-hidden="true">
      <span style={{ left: `${a}%`, width: `${Math.max(12, b - a)}%` }} />
    </span>
  );
}

function wallClock(ms: number, timeZone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return { hour, minute };
  } catch {
    const d = new Date(ms);
    return { hour: d.getHours(), minute: d.getMinutes() };
  }
}

function inQuiet(quiet: QuietHours, timeZone: string, now: number): boolean {
  if (quiet === "off") return false;
  const { hour } = wallClock(now, timeZone);
  if (quiet === "22-6") return hour >= 22 || hour < 6;
  return hour >= 23 || hour < 7;
}

function isMorning(at: string, timeZone: string, now: number): boolean {
  const [h, m] = at.split(":").map(Number);
  const clock = wallClock(now, timeZone);
  const cur = clock.hour * 60 + clock.minute;
  const start = (h ?? 6) * 60 + (m ?? 0);
  return cur >= start && cur <= start + 50;
}

function buildAlerts(
  bundle: WeatherBundle,
  prefs: { windAlert: number; rainAlert: number; dustAlert: number },
  lang: Lang,
  now: number,
): string[] {
  if (!bundle.hourly.length) return [];
  const msgs: string[] = [];
  const hour = bundle.hourly.reduce((best, row) => (Math.abs(row.t - now) < Math.abs(best.t - now) ? row : best), bundle.hourly[0]);
  if (hour && hour.uv >= 8) msgs.push(t(lang, "alertUv"));
  if (bundle.current.wind >= prefs.windAlert) msgs.push(t(lang, "alertWind"));
  if (bundle.current.precip >= prefs.rainAlert) msgs.push(t(lang, "alertRainNow"));
  else if ((bundle.daily[0]?.precip ?? 0) >= prefs.rainAlert) msgs.push(t(lang, "alertRain"));
  if ((bundle.air?.dust ?? 0) >= prefs.dustAlert) msgs.push(t(lang, "alertDust"));
  if ((bundle.air?.aqi ?? 0) >= 150) msgs.push(t(lang, "alertAir"));
  return msgs;
}

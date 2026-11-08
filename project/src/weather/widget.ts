import { readCacheFile } from "@/weather/api";
import { formatDayLabel, formatTemp, placeTitle } from "@/weather/format";
import { t, weatherKey } from "@/weather/i18n";
import type { Lang, Place, TempUnit, WeatherBundle } from "@/weather/types";

export function widgetIcon(code: number, isDay = true): string {
  if (code === 0) return isDay ? "sun" : "moon";
  if (code === 1 || code === 2) return isDay ? "partly" : "partly-night";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloud";
}

function citySnap(bundle: WeatherBundle, place: Place, lang: Lang, unit: TempUnit) {
  const now = Date.now();
  const hi = formatTemp(bundle.daily[0]?.tmax ?? bundle.current.temp, unit, lang);
  const lo = formatTemp(bundle.daily[0]?.tmin ?? bundle.current.temp, unit, lang);
  return {
    id: place.id,
    city: placeTitle(place, lang),
    temp: formatTemp(bundle.current.temp, unit, lang),
    condition: t(lang, weatherKey(bundle.current.code)),
    hilo: `↑ ${hi}   ↓ ${lo}`,
    icon: widgetIcon(bundle.current.code, bundle.current.isDay),
    days: bundle.daily.slice(0, 4).map((d) => ({
      name: formatDayLabel(d.t, bundle.timezone, lang, now),
      temp: `${formatTemp(d.tmax, unit, lang)}  ${formatTemp(d.tmin, unit, lang)}`,
      icon: widgetIcon(d.code, true),
    })),
  };
}

export const WIDGET_HERE = "@here";

export function widgetPayload(
  bundle: WeatherBundle,
  place: Place,
  places: Place[],
  lang: Lang,
  unit: TempUnit,
  rtl: boolean,
  here: { place: Place; bundle: WeatherBundle } | null,
) {
  const entries = readCacheFile().entries;
  const list = places.length ? places : [place];
  const cities = list.map((item) => {
    const source = item.id === place.id ? bundle : entries[item.id]?.bundle;
    if (!source) {
      return { id: item.id, city: placeTitle(item, lang), temp: "--°", condition: "", hilo: "", icon: "cloud", days: [] };
    }
    return citySnap(source, item, lang, unit);
  });
  const hereSnap = here ? { ...citySnap(here.bundle, here.place, lang, unit), id: WIDGET_HERE } : null;
  return { ...citySnap(bundle, place, lang, unit), rtl, cities, here: hereSnap };
}

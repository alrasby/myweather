/** Visual-only sky treatment for the home HERO, not a forecast provider.
 * Depends on the current city's WMO condition, measured cloud cover and wind.
 * Pure, bounded policy so it cannot trigger extra weather/network requests.
 */
export type HeroPrecipitation = "rain" | "snow" | "none";
export type HeroAtmosphere = {
  coverage: number;
  opacity: number;
  clouds: number;
  dark: boolean;
  precipitation: HeroPrecipitation;
  driftPxPerSecond: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export function heroAtmosphere(code: number, cloudCover: number, windKmh: number): HeroAtmosphere {
  const cover = clamp(cloudCover, 0, 100) / 100;
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const fog = code === 45 || code === 48;
  const overcast = code === 3 || fog;
  const partly = code === 2;
  // WMO code has higher confidence than a mismatched/sparse cloud field.
  const coverage = code === 0 ? Math.min(0.1, cover)
    : code === 1 ? Math.min(0.32, Math.max(0.12, cover))
    : partly ? Math.max(0.32, cover)
    : overcast ? Math.max(0.75, cover)
    : rain || snow ? Math.max(0.6, cover)
    : cover;
  return {
    coverage,
    opacity: coverage < 0.1 ? 0 : clamp(0.24 + coverage * 0.64, 0, 0.86),
    clouds: coverage < 0.13 ? 0 : coverage < 0.36 ? 1 : coverage < 0.72 ? 2 : 3,
    dark: code >= 95 || (rain && coverage > 0.72),
    precipitation: snow ? "snow" : rain ? "rain" : "none",
    driftPxPerSecond: clamp(1.2 + clamp(windKmh, 0, 80) * 0.07, 1.2, 6.8),
  };
}

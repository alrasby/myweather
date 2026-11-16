/** Visual-only deterministic rain geometry. Forecast observations are never
 * derived from or changed by these particles. Built once per WMO transition,
 * with a strict upper bound for low-end Android canvas rendering. */
export type HeroRainStreak = Readonly<{
  x: number; y: number; depth: number; length: number;
  width: number; opacity: number; speed: number; drift: number;
}>;

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
const hash = (n: number, salt: number) => {
  const v = Math.sin(n * salt) * 43758.5453;
  return v - Math.floor(v);
};

/** Slightly denser than the former 10+20*coverage (~22–30) sparse strokes.
 * WMO drizzle remains light; rain/shower/thunder gains depth but never
 * changes actual forecast rainfall amount or rain probability. */
export function heroRainStreaks(code: number, coverage: number, windKmh: number): HeroRainStreak[] {
  const heavy = code === 65 || code === 67 || code === 82 || code >= 95;
  const light = code >= 51 && code <= 55;
  const base = heavy ? 55 : light ? 30 : 43;
  const count = Math.min(64, Math.round(base + clamp(coverage, 0, 1) * 9));
  const wind = clamp(windKmh, 0, 75);
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const z = hash(n, 29.31);
    // Three depths: distant fine rain, middle droplets, occasional stronger
    // foreground beads. Small bright heads are painted only in foreground.
    const depth = z < 0.30 ? 0 : z < 0.82 ? 1 : 2;
    const length = [4.2, 7.7, 11.1][depth]! + hash(n, 63.21) * [2.3, 3.0, 4.2][depth]!;
    return {
      x: hash(n, 78.233), y: hash(n, 17.37), depth,
      length, width: [0.65, 1.0, 1.3][depth]!,
      opacity: [0.22, 0.47, 0.68][depth]! + hash(n, 12.9898) * 0.11,
      speed: [47, 82, 113][depth]! + hash(n, 44.31) * 25,
      drift: (2.5 + wind * 0.24) * [0.55, 1, 1.35][depth]!,
    };
  });
}

/** Forecast integrity helpers: preserve source-model temporal meaning. */

/** MET.no next_6_hours / next_12_hours are *accumulations over those windows*.
 * Treating each as a 1-hour amount multiplied daily rainfall by up to twelve.
 * Convert to an hourly rate before expanding any coarse forecast slot.
 */
export function metRainRate(
  oneHour: number | null | undefined,
  sixHours: number | null | undefined,
  twelveHours: number | null | undefined,
): number {
  const valid = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (valid(oneHour)) return oneHour!;
  if (valid(sixHours)) return sixHours! / 6;
  if (valid(twelveHours)) return twelveHours! / 12;
  return 0;
}

/** Protect against accidentally presenting an expired remote current snapshot
 * as live conditions (time in milliseconds); tolerate slow device clocks.
 */
export function isRecentObservation(observedMs: number, nowMs: number): boolean {
  return Number.isFinite(observedMs) && Number.isFinite(nowMs)
    && observedMs >= nowMs - 8 * 3600_000
    && observedMs <= nowMs + 3 * 3600_000;
}

/** Daily temperatures are source-provided, not recomputed from partial hours. */
export function validDailyTemperatures(max: number, min: number): boolean {
  return Number.isFinite(max) && Number.isFinite(min) && max >= min
    && min >= -100 && max <= 65;
}

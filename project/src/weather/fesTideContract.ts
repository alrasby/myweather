/** Strict client schema for the future, opt-in FES2022b gateway.
 *
 * Do NOT mix with Open-Meteo sea_level_height_msl: FES is astronomical tide
 * relative to atlas MSL, not observed/total coastal water level.
 * No request is sent by this module; feature is OFF in the APK.
 */
export type FesPilotSample = Readonly<{ t: number; levelM: number }>;
export type FesPilotEvent = Readonly<{
  kind: "high" | "low"; t: number; levelM: number;
}>;
export type FesPilotForecast = Readonly<{
  source: "FES2022b";
  status: "physical_model_unvalidated_at_local_gauge";
  datum: "atlas_mean_sea_level";
  points: readonly FesPilotSample[];
  extrema: readonly FesPilotEvent[];
  start: number;
  end: number;
  stepMinutes: 5;
  isApprovedForPublicDisplay: false;
}>;

type RecordLike = Record<string, unknown>;
const isRecord = (x: unknown): x is RecordLike =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const time = (v: unknown): number =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)
    ? Date.parse(v) : NaN;

/** Fail closed on missing quality/provenance, fabricated samples, stale
 * windows, wrong physical datum or unsourced extrema. */
export function parseFesPilotForecast(
  raw: unknown, requestedLat: number, requestedLon: number, startUtcMs: number, hours: number,
): FesPilotForecast | null {
  if (!isRecord(raw) || raw.source !== "FES2022b" ||
      raw.status !== "physical_model_unvalidated_at_local_gauge" ||
      raw.datum !== "atlas_mean_sea_level" || raw.height_unit !== "m" ||
      raw.not_for_navigation !== true || raw.step_minutes !== 5 ||
      !num(raw.interpolation_points_min) || raw.interpolation_points_min < 1 ||
      !num(raw.latitude) || !num(raw.longitude) ||
      Math.abs(raw.latitude - requestedLat) > 1e-8 ||
      Math.abs(raw.longitude - requestedLon) > 1e-8 ||
      !Number.isInteger(hours) || hours < 12 || hours > 72 ||
      !Number.isFinite(startUtcMs) || startUtcMs % 300000 !== 0 ||
      !Array.isArray(raw.samples) || !Array.isArray(raw.extrema) ||
      raw.samples.length !== hours * 12 + 1 ||
      raw.extrema.length > 40 ||
      time(raw.start) !== startUtcMs ||
      time(raw.end) !== startUtcMs + hours * 3600000) return null;

  const points: FesPilotSample[] = [];
  const known = new Map<number, number>();
  for (let i = 0; i < raw.samples.length; i++) {
    const p: unknown = raw.samples[i];
    if (!isRecord(p) || !num(p.level_m) || Math.abs(p.level_m) > 30 ||
        time(p.time) !== startUtcMs + i * 300000) return null;
    const t = startUtcMs + i * 300000;
    points.push({ t, levelM: p.level_m });
    known.set(t, p.level_m);
  }

  const extrema: FesPilotEvent[] = [];
  let last = -Infinity;
  for (const event of raw.extrema) {
    if (!isRecord(event) || (event.kind !== "high" && event.kind !== "low") ||
        !num(event.level_m) || event.time_resolution_minutes !== 5) return null;
    const t = time(event.time);
    const actual = known.get(t);
    if (!Number.isFinite(t) || t <= last || actual === undefined ||
        Math.abs(actual - event.level_m) > 1e-4 ||
        t <= startUtcMs || t >= startUtcMs + hours * 3600000) return null;
    last = t;
    extrema.push({ kind: event.kind, t, levelM: actual });
  }
  return {
    source: "FES2022b",
    status: "physical_model_unvalidated_at_local_gauge",
    datum: "atlas_mean_sea_level",
    points,
    extrema,
    start: startUtcMs,
    end: startUtcMs + hours * 3600000,
    stepMinutes: 5,
    isApprovedForPublicDisplay: false,
  };
}

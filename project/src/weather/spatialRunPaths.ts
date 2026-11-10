/** ECMWF spatial data is stored as ONE .om file per forecast valid-time,
 * under the model REFERENCE run directory. Using latest.json in every tile
 * adds a metadata capture/resolve fetch to the OM protocol. Prefer direct
 * run-pinned files after a fresh completed run has been verified.
 * Open-Meteo format: .../<model>/YYYY/MM/DD/hhmmZ/YYYY-MM-DDThhmm.om
 */
export type SpatialRun = { referenceTime: number; validTimes: readonly number[] };
const stamp = (ms:number) => {
  const d = new Date(ms);
  return {
    date: d.toISOString().slice(0,10),
    hhmm: d.toISOString().slice(11,16).replace(":",""),
  };
};
export function spatialOmFileUrl(modelBase: string, run: SpatialRun, index: number): string | null {
  if (!Number.isFinite(run.referenceTime) || !Number.isInteger(index) ||
      index < 0 || index >= run.validTimes.length) return null;
  const validTime = run.validTimes[index];
  if (!Number.isFinite(validTime)) return null;
  const root = modelBase.replace(/\/+$/, "");
  const reference = stamp(run.referenceTime);
  const valid = stamp(validTime);
  const folder = reference.date.replace(/-/g,"/");
  return `${root}/${folder}/${reference.hhmm}Z/${valid.date}T${valid.hhmm}.om`;
}
export function spatialForecastIntervalHours(times: readonly number[], index: number): number {
  const delta = index > 0
    ? (times[index] ?? 0) - (times[index-1] ?? 0)
    : (times[1] ?? 0) - (times[0] ?? 0);
  return Math.max(1, Math.round(delta / 3600_000) || 1);
}

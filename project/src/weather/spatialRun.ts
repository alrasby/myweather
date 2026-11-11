/** Resolve an ECMWF capture descriptor ONCE into immutable model-run URLs.
 *
 * @openmeteo/weather-map-layer's Capture API fetches latest.json while
 * resolving tile URLs and caches that descriptor for only 60 seconds. A live
 * animation can therefore mix two model runs when latest.json updates, and
 * repeated Capture resolution adds unnecessary work on mobile.
 *
 * Mirror the official parseMetaJson path layout and deltaTimeHoursAt rule,
 * using the exact valid time for each step. No synthetic cloud movement. */
export type PinnedSpatialRun = {
  referenceTime: number;
  validTimes: readonly number[];
  root: string;
};

const MODEL_ROOT = "https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs";

const pad = (n: number) => String(n).padStart(2, "0");

export function pinSpatialRun(json: {
  reference_time?: string;
  valid_times?: readonly string[];
  completed?: boolean;
}): PinnedSpatialRun | null {
  const ref = Date.parse(json.reference_time ?? "");
  const validTimes = (json.valid_times ?? []).map((value) => Date.parse(value));
  if (!Number.isFinite(ref) || validTimes.length === 0 ||
      validTimes.some((ms, i) => !Number.isFinite(ms) || (i > 0 && ms <= validTimes[i - 1]!))) {
    return null;
  }
  const d = new Date(ref);
  const root = `${MODEL_ROOT}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${pad(d.getUTCHours())}00Z`;
  return { referenceTime: ref, validTimes, root };
}

export function pinnedSpatialTileUrl(run: PinnedSpatialRun, variable: string, step: number): string {
  const at = run.validTimes[step];
  if (at === undefined || !Number.isFinite(at)) throw new Error("invalid ECMWF model time step");
  const time = new Date(at);
  const fileName = `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())}T${pad(time.getUTCHours())}00.om`;
  const params = new URLSearchParams({
    variable,
    interpolation: "linear",
    color_blend: "true",
  });
  // Precipitation and snowfall in .om files are step totals. Om-protocol
  // divides by this period to render the correct per-hour rate.
  if (run.validTimes.length > 1) {
    const prev = step === 0 ? run.validTimes[0]! : run.validTimes[step - 1]!;
    const next = step === 0 ? run.validTimes[1]! : at;
    const deltaHours = ((step === 0 ? next - at : at - prev) / 3_600_000);
    if (deltaHours > 0 && Number.isFinite(deltaHours)) {
      params.set("delta_time_hours", String(deltaHours));
    }
  }
  return `om://${run.root}/${fileName}?${params.toString()}`;
}

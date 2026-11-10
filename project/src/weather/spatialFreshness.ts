/** Reject expired/stale ECMWF model runs instead of showing yesterday's
 * spatial clouds with today's slider date. Prefer a time-matched fallback.
 * Some older captures omit reference_time: in that case the valid forecast
 * window is the only defensible freshness signal.
 */
export type SpatialMetadata = {
  completed?: boolean;
  reference_time?: string;
  valid_times?: string[];
  variables?: string[];
};
export function spatialFreshness(meta: SpatialMetadata, now: number): { valid: boolean; reason: string | null; times: number[] } {
  const times = (meta.valid_times ?? []).map((t) => Date.parse(t)).filter(Number.isFinite).sort((a,b) => a-b);
  if (meta.completed === false) return { valid:false, reason:"ECMWF run is incomplete", times };
  if (times.length < 2) return { valid:false, reason:"ECMWF has no usable time steps", times };
  if (times[times.length-1] < now + 3600_000) return { valid:false, reason:"ECMWF forecast horizon has expired", times };
  if (times[0] > now + 3600_000) return { valid:false, reason:"ECMWF run starts in the future", times };
  if (meta.reference_time) {
    const ref = Date.parse(meta.reference_time);
    if (!Number.isFinite(ref) || ref > now + 3600_000 || now - ref > 48 * 3600_000) {
      return { valid:false, reason:"ECMWF model run is outdated", times };
    }
  }
  return { valid:true, reason:null, times };
}

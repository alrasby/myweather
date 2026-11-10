/** Limit ECMWF decoding to one incomplete forecast hour at a time.
 * Prioritize the current requested frame; prefetch the following frame only
 * after the requested frame has completed. This prevents playing a 20-second
 * tile workload for every obsolete hour while the timeline advances. */
export function planSpatialRequests(
  requested: number,
  total: number,
  ready: ReadonlySet<number>,
  loading: ReadonlySet<number>,
  blocked: ReadonlySet<number>,
): { cancel: number[]; start: number | null } {
  const candidates = [requested, requested + 1].filter(
    (step) => step >= 0 && step < total && !ready.has(step) && !blocked.has(step),
  );
  const desired = candidates[0] ?? null;
  const cancel = [...loading].filter((step) => step !== desired);
  return {
    cancel,
    start: desired !== null && !loading.has(desired) ? desired : null,
  };
}

/** A playing rain map may advance past a temporal boundary only when the
 * prospective spatial hour is ready. If there are no spatial images yet, or
 * an upstream retry backoff is active, allow the UI to keep moving instead
 * of freezing forever on a missing provider response. */
export function canAdvanceSpatialTime(
  requested: number,
  ready: ReadonlySet<number>,
  blocked: ReadonlySet<number>,
  loading: ReadonlySet<number> = new Set(),
): boolean {
  // While the first model frame is decoding, hold playback instead of
  // generating dozens of obsolete requests. If decoding failed and the frame
  // is cooling down, let the coarse fallback continue to play.
  if (!ready.size) return !loading.size || blocked.has(requested);
  return ready.has(requested) || ready.has(requested + 1) || blocked.has(requested);
}

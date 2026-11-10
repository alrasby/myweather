/** Maximum time a refreshed visible viewport can defer *starting* the
 * next forecast. Continuous panning must not starve animation forever. */
export const SPATIAL_PREFETCH_GRACE_MS = 2500;

/** Limit ECMWF decoding to one incomplete forecast hour at a time.
 * Prioritize the requested frame and visible tiles, but give the following
 * hour a bounded turn even while the user continuously pans. */
export function planSpatialRequests(
  requested: number,
  total: number,
  ready: ReadonlySet<number>,
  loading: ReadonlySet<number>,
  blocked: ReadonlySet<number>,
  currentViewportRefreshing = false,
  visibleRefreshAgeMs = 0,
): { cancel: number[]; start: number | null } {
  const candidates = [requested, requested + 1].filter(
    (step) => step >= 0 && step < total && !ready.has(step) && !blocked.has(step),
  );
  // Existing in-flight prefetch is not cancelled just because Leaflet
  // briefly restarts a viewport tile queue. Doing that on every pan caused
  // expensive native HTTP churn. Defer only NEW prefetch during the grace
  // interval; after the deadline allow it even if map movement never stops.
  // A missing requested frame is always more important than prefetch.
  const prefetch = requested + 1;
  const deferred = currentViewportRefreshing && ready.has(requested) &&
    visibleRefreshAgeMs < SPATIAL_PREFETCH_GRACE_MS &&
    !loading.has(prefetch);
  const desired = deferred ? null : candidates[0] ?? null;
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

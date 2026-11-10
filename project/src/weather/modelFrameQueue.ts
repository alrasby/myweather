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
  // Keep two upcoming hours prepared without decoding more than one
  // incomplete frame at a time. The second lookahead becomes eligible only
  // after both the requested and next forecast are fully available.
  const lookahead = ready.has(requested) && ready.has(requested + 1) ? requested + 2 : -1;
  const candidates = [requested, requested + 1, lookahead].filter(
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
    loading.size === 0;
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
  // A ready FUTURE hour must not authorize displaying an unavailable
  // requested hour. That advanced the clock over stale older cloud tiles.
  // Failed hours may advance only via the explicitly selected global fallback
  // (modelFrameTimeline suppresses any stale held spatial frame in cooldown).
  if (blocked.has(requested)) return true;
  if (ready.has(requested)) return true;
  // No spatial frame exists: allow global fallback only when no model request
  // is in progress, so playback never silently outruns an active decode.
  return ready.size === 0 && loading.size === 0;
}

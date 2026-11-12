/** Maximum time a refreshed visible viewport can defer *starting* the
 * next forecast. Continuous panning must not starve animation forever. */
export const SPATIAL_PREFETCH_GRACE_MS = 2500;
export const SPATIAL_PLAYBACK_VIEWPORT_GRACE_MS = 1200;

/** Avoid cancelling an expensive native forecast decode for every tiny pan.
 * A real viewport shift (>35% of either dimension) or zoom invalidates
 * speculative work. Longitude is periodic across the dateline. */
export type SpatialViewCenter = { lat: number; lng: number; zoom: number };
export function significantSpatialMove(
  origin: SpatialViewCenter,
  current: SpatialViewCenter,
  latSpan: number,
  lonSpan: number,
): boolean {
  if (![origin.lat, origin.lng, origin.zoom, current.lat, current.lng, current.zoom, latSpan, lonSpan]
    .every(Number.isFinite) || latSpan <= 0 || lonSpan <= 0) return true;
  const lonShift = Math.abs((((current.lng - origin.lng) % 360) + 540) % 360 - 180);
  return Math.abs(current.zoom - origin.zoom) >= 0.75 ||
    Math.abs(current.lat - origin.lat) >= latSpan * 0.35 ||
    lonShift >= Math.min(360, lonSpan) * 0.35;
}

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
  playbackActive = false,
  viewportMoving = false,
): { cancel: number[]; start: number | null } {
  // Keep two upcoming hours prepared without decoding more than one
  // incomplete frame at a time. The second lookahead becomes eligible only
  // after both the requested and next forecast are fully available.
  // Second-hour lookahead is worthwhile only during active animation:
  // don't consume network and battery decoding unused hours on a still map.
  const lookahead = playbackActive && ready.has(requested) && ready.has(requested + 1)
    ? requested + 2 : -1;
  const candidates = [requested, requested + 1, lookahead].filter(
    (step) => step >= 0 && step < total && !ready.has(step) && !blocked.has(step),
  );
  // The visible viewport has precedence over future forecast hours, even
  // when prefetch was already in flight. A real new pan cancels speculation
  // once via ModelField.movestart, while this deterministic policy prevents
  // the cancelled frame from immediately restarting on a tile event.
  // Playback gets a shorter bound so its next hour cannot starve.
  const grace = playbackActive ? SPATIAL_PLAYBACK_VIEWPORT_GRACE_MS : SPATIAL_PREFETCH_GRACE_MS;
  const deferred = ready.has(requested) &&
    (viewportMoving || (currentViewportRefreshing && visibleRefreshAgeMs < grace));
  const desired = deferred ? null : candidates[0] ?? null;
  // Don't abort an in-flight speculative hour for a *small* gesture. Only
  // large pans/zoom discard it in ModelField; otherwise retain its cached
  // ranges, while blocking additional work until visible tiles settle.
  const cancel = deferred ? [] : [...loading].filter((step) => step !== desired);
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
  sourceBackedFallback = false,
): boolean {
  // A ready FUTURE hour must not authorize displaying an unavailable
  // requested hour. That advanced the clock over stale older cloud tiles.
  // Failed hours may advance only via the explicitly selected global fallback
  // (modelFrameTimeline suppresses any stale held spatial frame in cooldown).
  if (blocked.has(requested)) return true;
  if (ready.has(requested)) return true;
  // A real source-backed precipitation grid can display the requested time
  // while the heavier ECMWF spatial tiles finish. This never authorizes an
  // artificial grid or stale held ECMWF frame to masquerade as current.
  if (sourceBackedFallback) return true;
  // No spatial frame exists: allow global fallback only when no model request
  // is in progress, so playback never silently outruns an active decode.
  return ready.size === 0 && loading.size === 0;
}

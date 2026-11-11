import { nextEcmwfFrameToPrepare } from "./ecmwfDecodedStatePolicy.ts";

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
  playbackActive = false,
): { cancel: number[]; start: number | null } {
  // The OM decoder retains only the current forecast hour and the
  // adjacent hour (three fields each). Starting a second-hour lookahead
  // would evict the still-visible decoded fields and redo expensive WASM work.
  const next = nextEcmwfFrameToPrepare(requested, total, ready);
  const candidates = next === null || blocked.has(next) ? [] : [next];
  // If the requested hour is temporarily in retry cooldown, a *single*
  // adjacent fallback candidate is still permitted as before.
  if (candidates.length === 0 && blocked.has(requested) &&
      requested + 1 < total && !ready.has(requested + 1) &&
      !blocked.has(requested + 1)) candidates.push(requested + 1);
  // Existing in-flight prefetch is not cancelled just because Leaflet
  // briefly restarts a viewport tile queue. Doing that on every pan caused
  // expensive native HTTP churn. Defer only NEW prefetch during the grace
  // interval; after the deadline allow it even if map movement never stops.
  // A missing requested frame is always more important than prefetch.
  const prefetch = requested + 1;
  // During playback the next time step matters more than a background
  // pan refresh; do not stall prefetch for an extra 2.5 seconds.
  const deferred = !playbackActive && currentViewportRefreshing && ready.has(requested) &&
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

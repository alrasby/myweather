/** Distinguish a stalled ECMWF frame from a legitimately progressing one.
 * A fixed 20s deadline discarded slow but healthy cloud/rain/snow batches,
 * causing redundant network retries and temporary low-resolution fallback.
 * The progress watchdog lets tiles finish without hanging indefinitely. */
export const SPATIAL_IDLE_LIMIT_MS = 30_000;
export const SPATIAL_TOTAL_LIMIT_MS = 90_000;

export function spatialFrameTimedOut(
  now: number,
  startedAt: number,
  lastProgressAt: number,
  idleLimitMs = SPATIAL_IDLE_LIMIT_MS,
  totalLimitMs = SPATIAL_TOTAL_LIMIT_MS,
): boolean {
  return now - lastProgressAt >= idleLimitMs || now - startedAt >= totalLimitMs;
}

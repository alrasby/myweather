/** Keep heavy spatial scheduling separate from forecast opacity blending.
 * A frame can fade smoothly without repeatedly rescanning tile queues. */
export function shouldReplanSpatialFrame(
  baseChanged: boolean,
  nowMs: number,
  lastPlanMs: number,
  intervalMs = 500,
): boolean {
  return baseChanged || nowMs - lastPlanMs >= intervalMs;
}

/** ECMWF/fallback switch notifications are meaningful only on transitions. */
export function spatialCoverageChanged(previous: boolean, next: boolean): boolean {
  return previous !== next;
}

/** Per-layer elapsed time is measured from Leaflet's loading event.
 * No synthetic timings and no reliance on global Native HTTP counters. */
export type SpatialLayerTiming = {
  elapsedMs: number;
  firstTileMs: number | null;
  idleMs: number | null;
};
export function spatialLayerTiming(
  now: number,
  startedAt: number,
  firstTileAt: number,
  lastTileAt: number,
  finishedAt: number,
): SpatialLayerTiming {
  if (startedAt <= 0) return { elapsedMs: 0, firstTileMs: null, idleMs: null };
  const end = finishedAt >= startedAt ? finishedAt : now;
  return {
    elapsedMs: Math.max(0, end - startedAt),
    firstTileMs: firstTileAt >= startedAt ? firstTileAt - startedAt : null,
    idleMs: lastTileAt >= startedAt && finishedAt < startedAt
      ? Math.max(0, now - lastTileAt)
      : null,
  };
}

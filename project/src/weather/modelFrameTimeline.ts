/** Select ECMWF spatial frames without exposing the coarse fallback between
 * valid forecast hours. This is deliberately independent from Leaflet so the
 * loading/holding behaviour is deterministic and regression-testable. */
export type SpatialFramePlan = {
  goals: ReadonlyMap<number, number>;
  anchor: number | null;
  holding: boolean;
};

export function selectSpatialFramePlan(
  requested: number,
  blend: number,
  ready: ReadonlySet<number>,
  lastDisplayed: number | null,
  requestedInCooldown = false,
): SpatialFramePlan {
  const current = ready.has(requested);
  const next = ready.has(requested + 1);
  const goals = new Map<number, number>();
  // Never show an older OR future model hour for an unavailable requested
  // hour that the provider has put into retry cooldown.
  if (requestedInCooldown && !current) {
    return { goals, anchor: null, holding: false };
  }
  if (current && next) {
    const t = Math.max(0, Math.min(1, blend));
    goals.set(requested, 1 - t);
    goals.set(requested + 1, t);
    return { goals, anchor: t >= 0.5 ? requested + 1 : requested, holding: false };
  }
  if (current) {
    goals.set(requested, 1);
    return { goals, anchor: requested, holding: false };
  }
  // A preloaded FUTURE hour is not a substitute for an unavailable requested
  // time. A manual seek used to display that future cloud field beneath the
  // earlier timestamp, even though normal playback correctly held the clock.
  // Keep the previous complete frame explicitly marked as held instead.
  // While the requested frame loads, hold the last complete frame, but
  // prevent the playback clock from advancing beyond that ready hour.
  const held = lastDisplayed != null && ready.has(lastDisplayed)
    ? lastDisplayed
    : [...ready].sort((a, b) =>
      Math.abs(a - requested) - Math.abs(b - requested) || a - b
    )[0];
  if (held !== undefined) {
    goals.set(held, 1);
    return { goals, anchor: held, holding: true };
  }
  return { goals, anchor: null, holding: true };
}

/** Stacking only changes when the participating forecast hour IDs change;
 * changes to blend opacity must not reorder DOM layers on every frame. */
export function spatialStackKey(goals: ReadonlyMap<number, number>): string {
  return [...goals.keys()].join("|");
}

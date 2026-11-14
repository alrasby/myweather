/**
 * The time written below the map must not silently describe a different
 * hour from an already-visible ECMWF cloud/rain/snow raster.
 *
 * The slider/time interpolates continuously between source hours. Preserve
 * that interpolation when the visible source frames straddle the requested
 * time; only correct the label when a held or substantially stale SOURCE
 * raster is actually visible. Do not fabricate or alter any forecast data.
 */
export type MapForecastClock = {
  timeMs: number;
  status: "timeline" | "held-real-frame" | "corrected-real-frame";
  gapMinutes: number | null;
};

const HOUR_MS = 3_600_000;

export function mapForecastClock(
  timelineMs: number,
  visibleEcmwfTimes: readonly number[],
  holdingPreviousFrame = false,
): MapForecastClock {
  const usable = visibleEcmwfTimes.filter((t) => Number.isFinite(t) &&
    Math.abs(t) <= 8.64e15);
  if (!Number.isFinite(timelineMs) || Math.abs(timelineMs) > 8.64e15 || usable.length === 0) {
    return { timeMs: timelineMs, status: "timeline", gapMinutes: null };
  }
  const nearest = usable.reduce((best, time) =>
    Math.abs(time - timelineMs) < Math.abs(best - timelineMs) ? time : best);
  const gapMinutes = Math.round(Math.abs(nearest - timelineMs) / 60_000);

  // During a legitimate two-hour crossfade there is no unique on-screen
  // source hour. The slider's interpolated UTC time is truthful.
  const spanning = usable.length >= 2 &&
    Math.min(...usable) <= timelineMs && timelineMs <= Math.max(...usable);
  if (!holdingPreviousFrame && (spanning || Math.abs(nearest - timelineMs) <= HOUR_MS)) {
    return {timeMs: timelineMs, status: "timeline", gapMinutes};
  }

  // A frozen authentic ECMWF frame must never be labelled as the later
  // requested hour. When outside the source interval by >1 hour, likewise
  // show the genuine visible raster hour instead of the stale slider clock.
  return {
    timeMs: nearest,
    status: holdingPreviousFrame ? "held-real-frame" : "corrected-real-frame",
    gapMinutes,
  };
}

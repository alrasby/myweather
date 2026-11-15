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

  // Only TWO DISTINCT, truly visible source hours on opposite sides of
  // the requested time can justify a continuously interpolated label.
  // A lone 02:00 source image is still 02:00 even if the UI timeline has
  // advanced to 02:59:56 while 03:00 is decoding. The old <= 1 hour grace
  // incorrectly labeled the old image as almost 03:00 (device regression).
  const distinct = [...new Set(usable)];
  const spanning = distinct.length >= 2 &&
    Math.min(...distinct) <= timelineMs && timelineMs <= Math.max(...distinct);
  if (!holdingPreviousFrame && (spanning || nearest === timelineMs)) {
    return {timeMs: timelineMs, status: "timeline", gapMinutes};
  }

  // For a single genuinely visible source frame, its exact forecast hour
  // wins over the animated timeline. The normal hourly crossfade above
  // remains smooth whenever both authentic source hours are present.
  return {
    timeMs: nearest,
    status: holdingPreviousFrame ? "held-real-frame" : "corrected-real-frame",
    gapMinutes,
  };
}

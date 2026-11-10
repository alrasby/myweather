/** Weather forecast playback is data-bound: ECMWF needs time to decode three
 * spatial fields per hour. Keep wind/temperature unchanged, but make the
 * rain/snow timeline slower than the old 1.7 s/hour cadence. */
export function secondsPerForecastHour(kind: number): number {
  return kind === 2 ? 4 : 1.7;
}

export function nextPlaybackHour(
  current: number,
  dt: number,
  maximum: number,
  secondsPerHour: number,
  mayAdvance: (next: number) => boolean,
): { hour: number; waiting: boolean } {
  const candidate = current + Math.max(0, dt) / secondsPerHour >= maximum
    ? 0
    : current + Math.max(0, dt) / secondsPerHour;
  if (mayAdvance(candidate)) return { hour: candidate, waiting: false };
  return { hour: current, waiting: true };
}

/** Avoid flashing a spinner for sub-second cached tile refreshes. */
export function weatherLoadingPhase(waitingMs: number): 0 | 1 | 2 {
  if (waitingMs < 650) return 0;
  return waitingMs >= 8000 ? 2 : 1;
}

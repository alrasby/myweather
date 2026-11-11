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

/** Avoid repeatedly flashing a buffering message for short ECMWF boundary stalls.\n * Display only when the wait is meaningful; long delays stay visible. */
export function weatherLoadingPhase(waitingMs: number): 0 | 1 | 2 {
  if (waitingMs < 1800) return 0;
  return waitingMs >= 8000 ? 2 : 1;
}

/** A complete ECMWF spatial layer has already replaced the hidden rain-grid
 * canvas. Keep it cleared and avoid a redundant full-screen paint every RAF. */
export function shouldPaintWeatherFallback(kind: number, modelCover: boolean): boolean {
  return kind !== 2 || !modelCover;
}

/** Keep ECMWF timeline sync around 20Hz, without sampling rain point fields
 * 60 times per second while the main thread needs capacity for tile decode. */
export function shouldEmitRainFrame(nowMs: number, lastMs: number): boolean {
  return nowMs - lastMs >= 50 || lastMs === 0;
}

/** Raster rain/snow is painted by ECMWF, not particle sprites. The separate
 * cyclone overlay is the only rain-mode user of the particle canvas. */
export function needsRainOverlay(showCyclones: boolean, cycloneCount: number): boolean {
  return showCyclones && cycloneCount > 0;
}

/** Avoid repeatedly rasterizing static/slowly animated cyclone markers while
 * the ECMWF workers are decoding their own large tile canvases. */
export function shouldUpdateRainOverlay(nowMs: number, lastMs: number): boolean {
  return lastMs === 0 || nowMs - lastMs >= 80;
}

/** Point-grid fallback is a temporary safety net, not a 60fps weather layer.
 * Throttle only the rain-mode fallback while native ECMWF tiles decode. */
export function shouldUpdateRainFallback(nowMs: number, lastPaintMs: number): boolean {
  return lastPaintMs === 0 || nowMs - lastPaintMs >= 100;
}

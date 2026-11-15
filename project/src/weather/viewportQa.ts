/**
 * Strict SOURCE-truth verdict for the opt-in Android map QA probe.
 * Never validates physical forecast accuracy and never records coordinates,
 * request URLs, location names or private device data.
 */
export type QaCoverage = {delivered:number;required:number;hidden:number};
export type ViewportQaDiagnostics = {
  source: "spatial" | "fallback";
  frame: number;
  requestedFrame: number;
  displayedFrame: number | null;
  requestedValidTime: string | null;
  displayedValidTime: string | null;
  visibleOpacity: number;
  viewportHeld?: boolean;
  holdingPreviousFrame?: boolean;
  blendFraction?: number;
  currentTileCoverage?: QaCoverage[];
  /** Actual source contributors and the DOM tile coverage of EACH hour. */
  compositedViewportCoverage?: Array<{
    frame: number; validTime: string; opacity: number; coverage: QaCoverage[];
  }>;
  startupMs?: {firstCompleteReady:number|null};
  errors?: number[];
  modelRunPinned?: boolean;
  spatialViewportPolicy?: {allow:boolean;reason:string};
};

const genuineCoverage = (items: readonly QaCoverage[] | undefined) =>
  items?.length === 3 && items.every(c =>
    Number.isSafeInteger(c.required) && c.required > 0 &&
    Number.isSafeInteger(c.delivered) && c.delivered >= c.required &&
    Number.isSafeInteger(c.hidden) && c.hidden === 0);

function sameSourceTimes(data: ViewportQaDiagnostics, contributing: {
  frame:number;validTime:string;opacity:number;
}[]):boolean {
  const baseMs = data.requestedValidTime === null ? NaN : Date.parse(data.requestedValidTime);
  if (!Number.isFinite(baseMs) || !Number.isSafeInteger(data.requestedFrame) ||
    !Number.isSafeInteger(data.displayedFrame) || data.displayedFrame! < data.requestedFrame ||
    data.displayedFrame! > data.requestedFrame + 1) return false;
  const displayed = contributing.find(c => c.frame === data.displayedFrame);
  if (!displayed || displayed.validTime !== data.displayedValidTime ||
    !Number.isFinite(displayed.opacity) || displayed.opacity <= 0) return false;
  const valid = contributing.every(c => {
    if (!Number.isSafeInteger(c.frame) || !Number.isFinite(c.opacity) || c.opacity <= 0 ||
      c.opacity > 1 || c.frame < data.requestedFrame || c.frame > data.requestedFrame + 1) return false;
    if (c.frame === data.requestedFrame) return c.validTime === data.requestedValidTime;
    const t = Date.parse(c.validTime);
    // ECMWF lead-time cadence can be hourly or coarser at later horizons.
    return Number.isFinite(t) && t > baseMs && t - baseMs <= 3 * 3_600_000;
  });
  if (!valid) return false;
  if (data.displayedFrame === data.requestedFrame + 1 && contributing.length === 1) {
    // At 17:59:54 the 18Z raster can really be 100% visible even while
    // requestedFrame points to 17Z. It is valid ONLY when interpolation
    // reaches the endpoint; never accept a prefetched future hour as "now".
    return Number.isFinite(data.blendFraction) && data.blendFraction! >= 0.995 &&
      displayed.opacity >= 0.995;
  }
  return true;
}

export function viewportQaSnapshot(
  data: ViewportQaDiagnostics | null,
  mapZoom: number,
  span: { latitude: number; longitude: number },
) {
  const participants = data?.compositedViewportCoverage;
  const active = participants?.filter(c => c.opacity > 0.01) ?? [];
  const displayedCoverage = participants?.find(c => c.frame === data?.displayedFrame)?.coverage ??
    data?.currentTileCoverage ?? [];
  // Snapshot of exactly one model hour or a genuine two-hour interpolation.
  // Per-hour DOM tiles must be independently complete for every contributor.
  const covered = participants !== undefined
    ? active.length > 0 && active.length <= 2 &&
      active.every(c => genuineCoverage(c.coverage)) &&
      active.reduce((sum,c) => sum + c.opacity,0) >= 0.98
    : genuineCoverage(data?.currentTileCoverage);
  const timesCorrect = !!data && (participants !== undefined
    ? sameSourceTimes(data,active)
    : data.displayedFrame === data.requestedFrame &&
      data.displayedValidTime !== null &&
      data.displayedValidTime === data.requestedValidTime);
  const verifiedComplete = !!data && data.source === "spatial" &&
    data.displayedFrame !== null && timesCorrect && covered &&
    data.spatialViewportPolicy?.allow !== false &&
    data.modelRunPinned !== false &&
    !data.viewportHeld && !data.holdingPreviousFrame &&
    !(data.errors ?? []).some(error => error > 0) &&
    Number.isFinite(data.visibleOpacity) && data.visibleOpacity >= 0.98;
  const sourceVisible = !!data && data.source === "spatial" &&
    data.displayedFrame !== null && data.displayedValidTime !== null &&
    Number.isFinite(data.visibleOpacity) && data.visibleOpacity > 0;
  return {
    mapZoom: Number.isFinite(mapZoom) ? mapZoom : null,
    viewportSpanDegrees: {
      latitude: Number.isFinite(span.latitude) ? Math.max(0, Number(span.latitude.toFixed(1))) : null,
      longitude: Number.isFinite(span.longitude) ? Math.max(0, Number(span.longitude.toFixed(1))) : null,
    },
    status: verifiedComplete ? "complete" : sourceVisible
      ? "source-visible-pending-coverage" : "fallback-or-incomplete",
    verifiedComplete, source: data?.source ?? null,
    displayedFrame: data?.displayedFrame ?? null,
    requestedFrame: data?.requestedFrame ?? null,
    displayedValidTime: data?.displayedValidTime ?? null,
    requestedValidTime: data?.requestedValidTime ?? null,
    visibleOpacity: data?.visibleOpacity ?? 0,
    contributingFrames: active.length,
    coverage: displayedCoverage.map(c=>({delivered:c.delivered,required:c.required,hidden:c.hidden})),
    errors: data?.errors ?? [],
    viewportAllowed: data?.spatialViewportPolicy?.allow ?? null,
  };
}

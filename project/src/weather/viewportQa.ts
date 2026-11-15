/**
 * Source-strict diagnostic for isolated Android emulator map traversal.
 * Never shipped as an assertion of meteorological accuracy and never logs
 * coordinates, network URLs or a user-selected place.
 */
export type ViewportQaDiagnostics = {
  source: "spatial" | "fallback";
  frame: number;
  requestedFrame: number;
  displayedFrame: number | null;
  requestedValidTime: string | null;
  displayedValidTime: string | null;
  visibleOpacity: number;
  viewportHeld?: boolean;
  currentTileCoverage?: Array<{ delivered: number; required: number; hidden: number }>;
  startupMs?: { firstCompleteReady: number | null };
  errors?: number[];
  spatialViewportPolicy?: { allow: boolean; reason: string };
};

export function viewportQaSnapshot(
  data: ViewportQaDiagnostics | null,
  mapZoom: number,
  span: { latitude: number; longitude: number },
) {
  const coverage = data?.currentTileCoverage ?? [];
  const completeCoverage = coverage.length === 3 &&
    coverage.every(c => Number.isSafeInteger(c.required) && c.required > 0 &&
      Number.isSafeInteger(c.delivered) && c.delivered >= c.required &&
      c.hidden === 0);
  const requestedFrameVisible = !!data &&
    data.source === "spatial" &&
    data.displayedFrame !== null &&
    data.displayedFrame === data.requestedFrame &&
    data.displayedValidTime !== null &&
    data.requestedValidTime === data.displayedValidTime &&
    Number.isFinite(data.visibleOpacity) && data.visibleOpacity >= 0.6 &&
    !data.viewportHeld;
  const verifiedComplete = requestedFrameVisible && completeCoverage;
  const sourceVisible = !!data && data.source === "spatial" &&
    data.displayedFrame !== null &&
    data.displayedValidTime !== null &&
    Number.isFinite(data.visibleOpacity) && data.visibleOpacity > 0;
  // A transparent/stale first frame cannot pass just because a PREVIOUS
  // viewport had firstCompleteReady set. Every viewport is checked afresh.
  const status = verifiedComplete ? "complete" :
    sourceVisible ? "source-visible-pending-coverage" :
      "fallback-or-incomplete";
  return {
    mapZoom: Number.isFinite(mapZoom) ? mapZoom : null,
    viewportSpanDegrees: {
      latitude: Number.isFinite(span.latitude) ? Math.max(0, Number(span.latitude.toFixed(1))) : null,
      longitude: Number.isFinite(span.longitude) ? Math.max(0, Number(span.longitude.toFixed(1))) : null,
    },
    status, verifiedComplete,
    source: data?.source ?? null,
    displayedFrame: data?.displayedFrame ?? null,
    requestedFrame: data?.requestedFrame ?? null,
    displayedValidTime: data?.displayedValidTime ?? null,
    requestedValidTime: data?.requestedValidTime ?? null,
    visibleOpacity: data?.visibleOpacity ?? 0,
    coverage: coverage.map(c => ({ delivered: c.delivered, required: c.required, hidden: c.hidden })),
    errors: data?.errors ?? [],
    viewportAllowed: data?.spatialViewportPolicy?.allow ?? null,
  };
}

/** A second satellite raster grid is redundant at zooms where both Esri
 * layers resolve to identical {z,x,y} images. Enable the low-resolution
 * underlay only when the main imagery requests genuinely finer detail.
 * This reduces duplicate GPU compositing on Chrome/Android, where tile seams
 * may appear at the boundaries between separately transformed images.
 */
export const SATELLITE_UNDERLAY_NATIVE_ZOOM = 4;
/** A real native-z2 Esri grid keeps a tiny, geographically anchored parent
 * resident through successive world and regional pans. Re-mounting it only
 * after fine images vanish exposes a black viewport in the intervening frames.
 * Keep it warm through z6; beyond that, only a previously mounted parent may
 * survive until a genuine replacement is available. */
export const SATELLITE_WORLD_PARENT_NATIVE_ZOOM = 2;
export function shouldKeepWorldSatelliteParent(zoom: number, detailedReady: boolean): boolean {
  // Formerly the z2 grid was removed as soon as z4/detail was ready.
  // The next distant pan then had to FETCH the protection again, too late
  // for several source-backed background cells. Keep z2 resident at z3–z6
  // only; these are at most a handful of 256px native Esri tiles.
  void detailedReady;
  return Number.isFinite(zoom) && zoom >= 0 && zoom <= 6;
}

/** At z3/z4 a maxNativeZoom=4 parent requests exactly the same Esri URLs
 * as the detail layer, even if its opacity is zero. Unmount that duplicate;
 * the independent z2 parent protects broad world pans. Retain the genuinely
 * coarser z4 imagery at every closer zoom, regardless of detail readiness. */
export function shouldKeepSatelliteParent(zoom: number, _detailReady: boolean): boolean {
  return needsSatelliteUnderlay(zoom);
}
export function needsSatelliteUnderlay(
  zoom: number,
  nativeZoom = SATELLITE_UNDERLAY_NATIVE_ZOOM,
): boolean {
  return Number.isFinite(zoom) && zoom > nativeZoom;
}


/** Source-verified Esri parent handoff. The existing low-detail parents are
 * REAL georeferenced Esri tiles, never a screenshot of an obsolete continent.
 * Do not remove one parent merely because another GridLayer emitted `load`:
 * that event does not certify every current screen pixel tile.
 *
 * During the pinch, retain mounted parents and pre-mount only small coarser
 * grids that could safely cover the next zoom. At z3–z6, keeping the one
 * native-z2 source resident avoids a gap AFTER an earlier completed screen
 * released it. Above z6, unmount the inherited parent ONLY once the actual
 * replacement covers the current viewport. This reuses the existing z2/z4
 * sources, never a screenshot, a new provider, or fabricated weather pixels.
 */
export type SatelliteHandoffInput = Readonly<{
  zoom: number;
  zooming: boolean;
  mountedUnderlay: boolean;
  mountedWorld: boolean;
  detailComplete: boolean;
  underlayComplete: boolean;
  worldComplete: boolean;
}>;
export type SatelliteHandoffDecision = Readonly<{
  underlay: boolean;
  worldParent: boolean;
}>;
export function satelliteHandoffDecision(
  state: SatelliteHandoffInput,
): SatelliteHandoffDecision {
  if (!Number.isFinite(state.zoom) || state.zoom < 0) {
    return {underlay: state.mountedUnderlay, worldParent: state.mountedWorld};
  }
  const z = state.zoom;
  if (state.zooming) {
    return {
      // At least the z4 image grid may participate in a pinch starting from
      // the world boundary; do not dismantle old georeferenced imagery.
      underlay: state.mountedUnderlay || z >= 4,
      worldParent: state.mountedWorld || z <= 6,
    };
  }
  if (z <= 4) {
    // z4 underlay is redundant at z3/4 but can temporarily protect the
    // handoff from z5 while the z2 parent AND fine detail are both incomplete.
    return {
      worldParent: true,
      underlay: state.mountedUnderlay &&
        !state.worldComplete && !state.detailComplete,
    };
  }
  // At z5+ the genuine z4 imagery remains the standard parent. Keep the
  // small native-z2 Esri grid mounted and warm at z5–z6 even when the
  // current screen happens to be complete: prefetch-on-miss was too late for
  // rapid pans. At z7+ merely preserve an already mounted z2 parent until
  // a real, complete z4/detail viewport replaces it, limiting memory.
  const needsProtection = !state.underlayComplete && !state.detailComplete;
  return {
    underlay: true,
    worldParent: z <= 6 || (state.mountedWorld && needsProtection),
  };
}

/** Chromium on high-density Android devices can expose a 1 CSS-pixel
 * raster tile seam between individually GPU-composited Esri tile images.
 * Apply a small raster-only edge bleed; never stretch OM weather-model data.
 */
export function needsRasterSeamGuard(agent: string, dpr: number): boolean {
  return /Android/i.test(agent) && Number.isFinite(dpr) && dpr >= 1.5;
}

/** Read-only Esri image coverage, separate from ECMWF. No tile URLs, geographic
 * coordinates, or precise device location are ever included in the report.
 *
 * Leaflet's tile.current set includes buffered offscreen images and can omit
 * tiles that have not even been created for the latest screen. Therefore an
 * apparent 6/6 loaded 'current' set does NOT prove the visible screen is covered.
 * Count every expected grid position from the actual map pixel bounds, then
 * demand a real, successfully decoded image at the matching tile coordinate.
 */
export type SatelliteRasterLayerLike = {
  _tileZoom?: number;
  _tiles?: Record<string, {
    current?: boolean; loaded?: number;
    coords?: { x?: number; y?: number; z?: number };
    el?: object & { complete?: boolean; naturalWidth?: number };
  }>;
  isLoading?: () => boolean;
};
export type SatelliteRasterViewport = Readonly<{
  minX: number; maxX: number; minY: number; maxY: number;
  tileWidth: number; tileHeight: number;
}>;
export type SatelliteRasterCoverage = Readonly<{
  active: boolean; required: number; delivered: number; pending: number;
  missing: number; failed: number; loading: boolean; complete: boolean;
}>;
export function snapshotSatelliteRasterCoverage(
  layer: SatelliteRasterLayerLike | null,
  zoom: number,
  failedTiles: WeakSet<object> | undefined,
  viewport: SatelliteRasterViewport,
): SatelliteRasterCoverage {
  const loading = layer?.isLoading?.() === true;
  const empty = (active: boolean): SatelliteRasterCoverage => ({
    active, required: 0, delivered: 0, pending: 0,
    missing: 0, failed: 0, loading, complete: false,
  });
  if (!layer) return empty(false);
  const tileZoom = layer._tileZoom;
  // maxNativeZoom underlays may be at a coarser actual image tile zoom.
  // Convert map pixel bounds to their native image grid before verifying.
  const nativeZoom = tileZoom ?? NaN;
  if (!Number.isInteger(zoom) || !Number.isInteger(nativeZoom) ||
      nativeZoom < 0 || nativeZoom > zoom ||
      !Object.values(viewport).every(Number.isFinite) ||
      viewport.tileWidth <= 0 || viewport.tileHeight <= 0 ||
      viewport.maxX <= viewport.minX || viewport.maxY <= viewport.minY) {
    return empty(true);
  }
  const pixelScale = 2 ** (nativeZoom - zoom);
  const minX = Math.floor(viewport.minX * pixelScale / viewport.tileWidth);
  const maxX = Math.ceil(viewport.maxX * pixelScale / viewport.tileWidth) - 1;
  // EPSG:3857 is periodic in x, but it has no valid polar tiles beyond the
  // native mercator world. Preserve negative and >world x across long pans.
  const nativeMaxY = Math.ceil(256 * 2 ** nativeZoom / viewport.tileHeight) - 1;
  const minY = Math.max(0, Math.floor(viewport.minY * pixelScale / viewport.tileHeight));
  const maxY = Math.min(nativeMaxY, Math.ceil(viewport.maxY * pixelScale / viewport.tileHeight) - 1);
  const required = (maxX - minX + 1) * (maxY - minY + 1);
  // This is an opt-in diagnostic, not a rendering operation. Fail closed on
  // invalid or unexpectedly massive screen geometry rather than iterating.
  if (!Number.isSafeInteger(required) || required <= 0 || required > 4096) return empty(true);

  const tiles = new Map<string, NonNullable<SatelliteRasterLayerLike["_tiles"]>[string]>();
  for (const tile of Object.values(layer._tiles ?? {})) {
    if (tile.current !== true || tile.coords?.z !== nativeZoom ||
        !Number.isInteger(tile.coords?.x ?? NaN) || !Number.isInteger(tile.coords?.y ?? NaN)) continue;
    tiles.set(`${tile.coords!.x},${tile.coords!.y}`, tile);
  }
  let delivered = 0, failed = 0, missing = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = tiles.get(`${x},${y}`);
      if (!tile) { missing++; continue; }
      const image = tile.el;
      if (!image) continue;
      if (failedTiles?.has(image) === true ||
          (image.complete === true && image.naturalWidth === 0)) {
        failed++;
        continue;
      }
      if (tile.loaded && image.complete === true &&
          typeof image.naturalWidth === "number" && image.naturalWidth > 0) delivered++;
    }
  }
  const pending = required - delivered - failed;
  return {
    active: true, required, delivered, pending, missing, failed, loading,
    complete: delivered === required && missing === 0 && failed === 0 && !loading,
  };
}

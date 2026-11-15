/** Stage raster tiles for a small, already-covered ECMWF viewport refresh.
 *
 * Leaflet emits tileload for each independently decoded .om image, which
 * previously exposed rectangular fragments of a new viewport one at a time.
 * Hide only newly created tiles, not the buffered old images. Reveal the
 * entire new batch when the layer emits 'load' for that viewport. Initial
 * paints retain their existing cloud-first fast path; no extra raster copies.
 */
export type SpatialTileNode = {
  style: { visibility: string };
  animate?: (keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: KeyframeAnimationOptions) => Animation;
};

/** Soften the appearance of an independently decoded real tile. This is
 * strictly a short compositor-opacity animation, not a weather-data filter.
 * Never defer the tile request or hold a whole viewport on slow Android. */
export function softenSpatialTileArrival(tile: SpatialTileNode | undefined,
  allowed: boolean, reducedMotion = false): boolean {
  if (!allowed || reducedMotion || !tile || tile.style.visibility === "hidden" ||
      typeof tile.animate !== "function") return false;
  try {
    // Refine the transition without the low-alpha flash visible on mobile:
    // the genuine ECMWF pixel starts 92% visible, reaches full opacity in
    // 110 ms, and never changes the forecast's hue, palette, or geometry.
    // WAAPI is transient: no extra canvas, bitmap, timer or weather read.
    tile.animate([{ opacity: 0.92 }, { opacity: 1 }],
      { duration: 110, easing: "ease-out" });
    return true;
  } catch {
    return false;
  }
}

export class SpatialTileReveal {
  private held = new Map<SpatialTileNode, string>();

  hold(tile: SpatialTileNode | undefined): void {
    if (!tile || this.held.has(tile)) return;
    this.held.set(tile, tile.style.visibility);
    tile.style.visibility = "hidden";
  }

  release(): void {
    for (const [tile, visibility] of this.held) tile.style.visibility = visibility;
    this.held.clear();
  }

  discard(tile: SpatialTileNode | undefined): void {
    if (!tile) return;
    const visibility = this.held.get(tile);
    if (visibility === undefined) return;
    tile.style.visibility = visibility;
    this.held.delete(tile);
  }

  get pending(): number { return this.held.size; }
}

/** Only stage a new raster batch when previous tiles still cover most of the
 * new screen at the exact same zoom. During large pans or zoom changes
 * Leaflet unloads old tiles, so hiding newly arrived ones until 'load'
 * creates dark rectangular holes and delays usable weather coverage. */
export type SpatialRasterView = {
  west: number; east: number; south: number; north: number; zoom: number;
};

/** Measure ACTUAL overlapping geography, not historical DOM tile counts.
 * Longitude wraps at the international date line but latitude never does.
 * A 0 result means the old screen cannot justify retaining an ECMWF overlay.
 */
export function spatialViewportOverlap(
  previous: SpatialRasterView | null,
  next: SpatialRasterView,
): {latitude: number; longitude: number} | null {
  if (!previous) return null;
  const nums = [previous.west, previous.east, previous.south, previous.north, previous.zoom,
    next.west, next.east, next.south, next.north, next.zoom];
  if (!nums.every(Number.isFinite) || Math.abs(next.zoom - previous.zoom) > 0.01 ||
      next.east <= next.west || next.north <= next.south ||
      previous.east <= previous.west || previous.north <= previous.south) return null;
  const targetWidth = next.east - next.west;
  const targetHeight = next.north - next.south;
  const lat = Math.max(0, Math.min(next.north, previous.north) - Math.max(next.south, previous.south));
  let lon = 0;
  // Leaflet's world-wrap can express the same tile as ±360° longitude.
  for (const turns of [-1, 0, 1]) {
    const offset = Math.round((next.west - previous.west) / 360) * 360 + turns * 360;
    lon = Math.max(lon, Math.max(0,
      Math.min(next.east, previous.east + offset) -
      Math.max(next.west, previous.west + offset)));
  }
  return {latitude: lat / targetHeight, longitude: lon / targetWidth};
}
export function canStageSpatialRefresh(
  previous: SpatialRasterView | null,
  next: SpatialRasterView,
): boolean {
  const overlap = spatialViewportOverlap(previous, next);
  // Stage ALL incoming tiles only where most of the previous screen remains
  // visible. Larger shifts must reveal their genuine source pixels promptly.
  return !!overlap && overlap.latitude >= 0.78 && overlap.longitude >= 0.78;
}


/** During a small SAME-ZOOM pan, previously certified imagery still covers
 * most of the current geography. Keep its already-rendered DOM tiles visible
 * while the exact same ECMWF hour refills the missing edge. Never hold across
 * zoom changes, large cross-continent pans, provider errors or indefinitely.
 * This retains no new bitmaps or Float32Arrays on memory-constrained WebViews.
 */
export const SPATIAL_VIEWPORT_HOLD_MAX_MS = 7_500;

export function canHoldCertifiedSpatialViewport(
  previous: SpatialRasterView | null,
  current: SpatialRasterView,
  sourceOpacity: number,
  beganAtMs: number,
  nowMs: number,
): boolean {
  return sourceOpacity > 0.1 && Number.isFinite(nowMs) &&
    beganAtMs > 0 && nowMs >= beganAtMs &&
    nowMs - beganAtMs < SPATIAL_VIEWPORT_HOLD_MAX_MS &&
    // Holding old, GEOGRAPHICALLY CORRECT tiles is safe even if less than
    // 78% overlaps; one-raster-cell movement otherwise switches the entire
    // overlay off and produces the user's repeated clear/cloudy flicker.
    // Require meaningful overlap in both dimensions and independently
    // certified on-screen tiles (checked by ModelField before this call).
    (() => {
      const overlap = spatialViewportOverlap(previous, current);
      return !!overlap && overlap.latitude >= 0.25 && overlap.longitude >= 0.25;
    })();
}

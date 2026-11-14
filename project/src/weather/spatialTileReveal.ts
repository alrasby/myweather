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
    // A very low starting alpha flashes a dark 1024px rectangular patch
    // over satellite imagery. Keep genuine pixels mostly visible from the
    // first paint and use only a short compositor transition for the edge.
    tile.animate([{ opacity: 0.68 }, { opacity: 1 }],
      { duration: 160, easing: "ease-out" });
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

export function canStageSpatialRefresh(
  previous: SpatialRasterView | null,
  next: SpatialRasterView,
): boolean {
  if (!previous) return false;
  const nums = [previous.west, previous.east, previous.south, previous.north, previous.zoom,
    next.west, next.east, next.south, next.north, next.zoom];
  if (!nums.every(Number.isFinite) || Math.abs(next.zoom - previous.zoom) > 0.01 ||
      next.east <= next.west || next.north <= next.south ||
      previous.east <= previous.west || previous.north <= previous.south) return false;
  const targetWidth = next.east - next.west;
  const targetHeight = next.north - next.south;
  const lat = Math.max(0, Math.min(next.north, previous.north) - Math.max(next.south, previous.south));
  let lon = 0;
  // The Leaflet map is world-wrapped, so equivalent previous views may have
  // longitudes ±360 apart. Preserve overlap at the international dateline.
  for (const turns of [-1, 0, 1]) {
    const offset = Math.round((next.west - previous.west) / 360) * 360 + turns * 360;
    lon = Math.max(lon, Math.max(0,
      Math.min(next.east, previous.east + offset) -
      Math.max(next.west, previous.west + offset)));
  }
  return lat / targetHeight >= 0.78 && lon / targetWidth >= 0.78;
}

/** Stage raster tiles for one *already visible* ECMWF layer refresh.
 *
 * Leaflet emits tileload for each independently decoded .om image, which
 * previously exposed rectangular fragments of a new viewport one at a time.
 * Hide only newly created tiles, not the buffered old images. Reveal the
 * entire new batch when the layer emits 'load' for that viewport. Initial
 * paints retain their existing cloud-first fast path; no extra raster copies.
 */
export type SpatialTileNode = { style: { visibility: string } };

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

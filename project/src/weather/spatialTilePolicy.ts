/** Leaflet raster policy for the ECMWF forecast layers only.
 *
 * The global imagery baseline refreshes while panning, but previously the
 * Weather layers must not begin new tile reads while the viewport is
 * changing: updateCurrentBounds() is refreshed on moveend, BEFORE Leaflet
 * requests new tiles. Existing tiles stay onscreen throughout the gesture
 * and new viewport reads are spatially cropped, avoiding full-grid WASM
 * copies and stale-window rectangular holes.
 *
 * The Open-Meteo map-layer documentation describes useful native detail to
 * zoom 12. Beyond that we re-use native tiles rather than asking for false
 * additional forecast detail or unnecessarily decoding more tiles.
 */
/** Non-isolated Android WebView clones the full model variable for EACH
 * worker tile. One 1024px tile replaces up to four 512px worker jobs.
 * The URL explicitly requests 1024 model raster pixels: no image stretching.
 * A shared-memory browser retains the original 512px behavior. */
export const COMPACT_SPATIAL_TILE_SIZE = 1024;
export function useCompactSpatialTiles(native: boolean, isolated: boolean): boolean {
  return native && !isolated;
}

export function spatialTileOptions(pane: "wx-clouds" | "wx-model", compact = false) {
  return {
    pane,
    tileSize: compact ? COMPACT_SPATIAL_TILE_SIZE : 512,
    zoomOffset: compact ? -2 : -1,
    opacity: 0,
    updateWhenIdle: true,
    updateWhenZooming: false,
    updateInterval: 400,
    // A single surrounding ring covers normal short drags without
    // scheduling two extra rings of expensive OM decoding for every hour.
    keepBuffer: 1,
    maxNativeZoom: compact ? 13 : 12,
    maxZoom: 16,
  };
}

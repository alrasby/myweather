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
export function spatialTileOptions(pane: "wx-clouds" | "wx-model") {
  return {
    pane,
    opacity: 0,
    updateWhenIdle: true,
    updateWhenZooming: false,
    updateInterval: 400,
    // A single surrounding ring covers normal short drags without
    // scheduling two extra rings of expensive OM decoding for every hour.
    keepBuffer: 1,
    maxNativeZoom: 12,
    maxZoom: 16,
  };
}

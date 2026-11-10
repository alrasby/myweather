/** Leaflet raster policy for the ECMWF forecast layers only.
 *
 * The global imagery baseline refreshes while panning, but previously the
 * weather layers waited for moveend, leaving visible blank rectangular tile
 * regions during drags. Update spatial coverage at a bounded interval while
 * panning instead. Smooth zooms still update only after settling, so heavy
 * OM-file decoding is not restarted at every fractional zoom level.
 *
 * The Open-Meteo map-layer documentation describes useful native detail to
 * zoom 12. Beyond that we re-use native tiles rather than asking for false
 * additional forecast detail or unnecessarily decoding more tiles.
 */
export function spatialTileOptions(pane: "wx-clouds" | "wx-model") {
  return {
    pane,
    opacity: 0,
    updateWhenIdle: false,
    updateWhenZooming: false,
    updateInterval: 400,
    // A single surrounding ring covers normal short drags without
    // scheduling two extra rings of expensive OM decoding for every hour.
    keepBuffer: 1,
    maxNativeZoom: 12,
    maxZoom: 16,
  };
}

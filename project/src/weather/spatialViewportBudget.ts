/** Performance *quality* policy for genuine ECMWF grids on Android WebView.
 *
 * Never disable ECMWF simply because the map is at z3–z5. That was the
 * November 14 regression: `allow=false` hid all three model fields even
 * when actual data had been successfully decoded before the pan.
 *
 * The Leaflet adapter paints an ImageBitmap of any size into its 1024px tile
 * canvas using drawImage(bitmap, 0, 0, tileSize, tileSize). Render fewer
 * genuine model samples per broad tile; leave its geographic footprint,
 * timestamps, palette and three source variables unchanged. The resulting
 * image may be softer at world scale, but is NOT a substitute forecast.
 */
export type SpatialViewport = Readonly<{
  zoom: number; west: number; east: number; south: number; north: number;
}>;
export type SpatialViewportDecision = Readonly<{
  allow: boolean;
  reason: "regional" | "world-scale" | "longitude-band" | "latitude-band" | "invalid";
  /** Actual model sampling pixels, not the Leaflet tile's 1024 CSS pixels. */
  rasterSize: 256 | 512 | 1024;
}>;

/** This describes when more sampling is useful, NOT when ECMWF is allowed. */
export const ECMWF_REGIONAL_MIN_ZOOM = 6;
export const ECMWF_MAX_LATITUDE_SPAN = 22;
export const ECMWF_MAX_LONGITUDE_SPAN = 40;

export function decideSpatialViewport(v: SpatialViewport): SpatialViewportDecision {
  if (![v.zoom, v.west, v.east, v.south, v.north].every(Number.isFinite) ||
      v.north <= v.south || v.zoom < 0 || v.north > 90.1 || v.south < -90.1) {
    return { allow: false, reason: "invalid", rasterSize: 256 };
  }
  const lonSpan = v.east >= v.west ? v.east - v.west : v.east + 360 - v.west;
  const latSpan = v.north - v.south;
  if (!Number.isFinite(lonSpan) || lonSpan <= 0 || lonSpan > 360) {
    return { allow: false, reason: "invalid", rasterSize: 256 };
  }

  // At z3 one 1024px Leaflet tile spans a very large geographic area. A
  // 256px ECMWF sample grid avoids a million interpolation calls per tile,
  // yet still draws real cloud, precipitation and snowfall fields.
  if (v.zoom < ECMWF_REGIONAL_MIN_ZOOM) {
    return { allow: true, reason: "world-scale", rasterSize: v.zoom <= 3 ? 256 : 512 };
  }
  if (lonSpan > ECMWF_MAX_LONGITUDE_SPAN) {
    return { allow: true, reason: "longitude-band", rasterSize: 512 };
  }
  if (latSpan > ECMWF_MAX_LATITUDE_SPAN) {
    return { allow: true, reason: "latitude-band", rasterSize: 512 };
  }
  return { allow: true, reason: "regional", rasterSize: v.zoom >= 8 ? 1024 : 512 };
}

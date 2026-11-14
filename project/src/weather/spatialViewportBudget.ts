/** Explicit, source-preserving render budget for ECMWF on-device .om reads.
 *
 * A 1024px reduced-Gaussian worker tile at low map zoom can cover a large
 * fraction of Earth. Three fields × multiple temporal frames compete for
 * identical 26 MiB decoded arrays; the source data+worker bitmaps overwhelm
 * Android WebView while satellite imagery is also fetching.
 *
 * A broad view should use the already-existing, real source-backed world
 * rain/snow fallback until the user zooms into a tractable region. This is
 * NOT an artificial forecast and never labels a generic field "ECMWF".
 */
export type SpatialViewport = Readonly<{
  zoom:number; west:number; east:number; south:number; north:number;
}>;
export type SpatialViewportDecision = Readonly<{
  allow:boolean;
  reason:"regional"|"world-scale"|"longitude-band"|"latitude-band"|"invalid";
}>;

/** Device QA (Nov 2026): zoom 3, lat 108.4°, lon 63.3° incurred
 * 242 MB JS heap, 138 cancellations and 12.18-second cloud P95.
 * Even at zoom 5 (25° high), partial model reads reached 7.76 seconds.
 * Do not enter that unbounded full-continent decode regime. */
export const ECMWF_REGIONAL_MIN_ZOOM=6;
export const ECMWF_MAX_LATITUDE_SPAN=22;
export const ECMWF_MAX_LONGITUDE_SPAN=40;

export function decideSpatialViewport(v:SpatialViewport):SpatialViewportDecision {
  if (![v.zoom,v.west,v.east,v.south,v.north].every(Number.isFinite) ||
      v.north<=v.south || v.zoom<0 || v.north>90.1 || v.south< -90.1)
    return {allow:false,reason:"invalid"};
  const longitudeSpan=v.east>=v.west?v.east-v.west:v.east+360-v.west;
  const latitudeSpan=v.north-v.south;
  if (!Number.isFinite(longitudeSpan) || longitudeSpan<=0 || longitudeSpan>360)
    return {allow:false,reason:"invalid"};
  if (v.zoom < ECMWF_REGIONAL_MIN_ZOOM)
    return {allow:false,reason:"world-scale"};
  if (longitudeSpan>ECMWF_MAX_LONGITUDE_SPAN)
    return {allow:false,reason:"longitude-band"};
  if (latitudeSpan>ECMWF_MAX_LATITUDE_SPAN)
    return {allow:false,reason:"latitude-band"};
  return {allow:true,reason:"regional"};
}

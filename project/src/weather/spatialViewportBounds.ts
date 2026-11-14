/** Bounds used by Open-Meteo's updateCurrentBounds() partial .om reader.
 *
 * The global IFS model is far larger than a typical mobile viewport. Keep
 * reading a padded window around the *actual* Leaflet view, not the whole
 * globe. The upstream reader snaps this window to stable tile boundaries.
 *
 * Use the same regional window for equivalent 360-degree world copies.
 * Clamp padding near +/-180 rather than falling back to the entire globe
 * when the visible viewport itself stays on one side of the dateline.
 * A genuinely split/wrapped viewport still uses the full model safely. */
export type SpatialView = { west: number; east: number; south: number; north: number };
export type SpatialBounds = [number, number, number, number];

const LAT_LIMIT = 85.0511287798;
const GLOBAL: SpatialBounds = [-180, -LAT_LIMIT, 180, LAT_LIMIT];

/** Full longitude is unavoidable in a single OM window when a view crosses
 * the antimeridian. The latitude need NOT span both poles, however. Avoid
 * decoding several million invisible global samples for a 20-degree band.
 * Preserve the whole requested visible latitude with 10% vertical padding.
 */
export function worldLongitudeLatitudeBand(south: number, north: number): SpatialBounds {
  if (!Number.isFinite(south) || !Number.isFinite(north) || north <= south)
    return [...GLOBAL];
  const padding = Math.max(0.1, (north - south) * 0.1);
  const s = Math.max(-LAT_LIMIT, south - padding);
  const n = Math.min(LAT_LIMIT, north + padding);
  if (s >= n) return [...GLOBAL];
  return [-180, s, 180, n];
}

export function spatialViewportBounds(view: SpatialView): SpatialBounds {
  const { west, east, south, north } = view;
  if (![west, east, south, north].every(Number.isFinite) || north <= south)
    return [...GLOBAL];
  // Some map adapters report a dateline-crossing box as west > east
  // instead of Leaflet's unwrapped longitude. Unwrap once, preserving the
  // actual latitude band instead of reading the entire global OM dataset.
  const unwrappedEast = east < west && east + 360 > west ? east + 360 : east;
  if (unwrappedEast <= west) return [...GLOBAL];
  const width = unwrappedEast - west;
  const height = north - south;
  if (width >= 300) return worldLongitudeLatitudeBand(south, north);

  // Leaflet preserves unwrapped longitudes across 360-degree pans. The
  // weather field is periodic in longitude, so the same regional window
  // must be requested whether a city is viewed at 20 or 380 degrees.
  const turns = Math.floor((west + 180) / 360);
  const normalizedWest = west - turns * 360;
  const normalizedEast = normalizedWest + width;
  // A truly dateline-crossing viewport requires full longitude for this
  // upstream single-window API, but should still read ONLY visible latitudes.
  // Using both polar caps at every dateline crossing caused massive wasted
  // binary range reads, excess WebView heap and zoom-out stalls.
  if (normalizedWest < -180 || normalizedEast > 180)
    return worldLongitudeLatitudeBand(south, north);

  const lonPad = Math.max(0.1, width * 0.1);
  const latPad = Math.max(0.1, height * 0.1);
  // Only the *padding* can cross the dateline here. Trimming it does not
  // remove any visible area, and avoids very costly unnecessary global IO.
  const w = Math.max(-180, normalizedWest - lonPad);
  const e = Math.min(180, normalizedEast + lonPad);
  const s = Math.max(-LAT_LIMIT, south - latPad);
  const n = Math.min(LAT_LIMIT, north + latPad);
  if (s >= n || w >= e) return [...GLOBAL];
  return [w, s, e, n];
}

/**
 * The bounded .om dataset MUST cover the COMPLETE physical Leaflet tile
 * footprint, not just the smaller screen rectangle. GridLayer caches a
 * rendered canvas by tile x/y/z. After a same-tile pan it reuses that canvas
 * without fetching again. If the .om reader was cropped to the *old screen*,
 * the cached canvas has permanent transparent strips in the newly exposed
 * area: the hard rectangles seen in Android ECMWF cloud/rain playback.
 *
 * This snaps the read once to the REAL Leaflet model tile grid at the view's
 * zoom and tileSize. It is stable while the visible tiles remain the same,
 * so reusing a cached raster never exposes previously unsampled pixels.
 * No fabricated field data or model interpolation changes.
 */
export function spatialTileAlignedBounds(
  view: SpatialView,
  mapZoom: number,
  physicalTileSize: 256 | 512 | 1024,
): SpatialBounds {
  const fallback = spatialViewportBounds(view);
  const {west,east,south,north} = view;
  if (![west,east,south,north,mapZoom].every(Number.isFinite) ||
      north <= south || ![256,512,1024].includes(physicalTileSize)) return fallback;
  const width = east >= west ? east - west : east + 360 - west;
  if (width <= 0 || width > 360) return fallback;

  // GridLayer's physical 512px tile at map zoom 5 has the geographic
  // footprint of a 256px world tile at z4. The 1024px compact variant
  // corresponds to z3. This matches the adapter's zoomOffset exactly.
  const offset = physicalTileSize === 1024 ? -2 :
    physicalTileSize === 512 ? -1 : 0;
  const z = Math.max(0, Math.round(mapZoom) + offset);
  const tiles = 2 ** Math.min(z, 16);
  const tileDeg = 360 / tiles;
  const normalWest = ((west + 180) % 360 + 360) % 360 - 180;
  const x0 = Math.floor((normalWest + 180) / tileDeg);
  const x1 = Math.ceil((normalWest + width + 180) / tileDeg);
  // A single-rectangle .om crop cannot cross the longitude seam. The
  // latitude band still remains tiled and bounded; never use both poles
  // simply because Leaflet unwrapped a longitude.
  const snappedWest = x0 * tileDeg - 180;
  const snappedEast = x1 * tileDeg - 180;
  const clipLat = (latitude:number) => Math.max(-LAT_LIMIT,Math.min(LAT_LIMIT,latitude));
  const tileY = (latitude:number) => {
    const radians = clipLat(latitude)*Math.PI/180;
    return (1-Math.asinh(Math.tan(radians))/Math.PI)/2*tiles;
  };
  const tileLat = (y:number) =>
    Math.atan(Math.sinh(Math.PI * (1-2*y/tiles)))*180/Math.PI;
  const y0 = Math.max(0,Math.floor(tileY(north)));
  const y1 = Math.min(tiles,Math.ceil(tileY(south)));
  // A single sample row beyond the tile avoids seams at the interpolation
  // boundary, without adding an entire 90-degree tile as padding.
  const latPad = 0.25, lonPad = 0.25;
  const alignedSouth = Math.max(-LAT_LIMIT,tileLat(y1)-latPad);
  const alignedNorth = Math.min(LAT_LIMIT,tileLat(y0)+latPad);
  if (alignedNorth <= alignedSouth) return fallback;
  if (snappedWest < -180 || snappedEast > 180 || width >= 360) {
    return [-180,alignedSouth,180,alignedNorth];
  }
  return [
    Math.max(-180,snappedWest-lonPad),
    alignedSouth,
    Math.min(180,snappedEast+lonPad),
    alignedNorth,
  ];
}

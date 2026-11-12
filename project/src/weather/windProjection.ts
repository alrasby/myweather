/** Project the nearest equivalent longitude to the current world copy.
 * Leaflet allows continuous horizontal panning, while weather grids store
 * -180..180. Particle paths must not jump a complete globe at the seam. */
export function nearestWorldLongitude(longitude: number, centerLongitude: number): number {
  if (!Number.isFinite(longitude) || !Number.isFinite(centerLongitude)) return longitude;
  return longitude + 360 * Math.round((centerLongitude - longitude) / 360);
}

/** Project the nearest equivalent longitude to the current world copy.
 * Leaflet allows continuous horizontal panning, while weather grids store
 * -180..180. Particle paths must not jump a complete globe at the seam. */
export function nearestWorldLongitude(longitude: number, centerLongitude: number): number {
  if (!Number.isFinite(longitude) || !Number.isFinite(centerLongitude)) return longitude;
  return longitude + 360 * Math.round((centerLongitude - longitude) / 360);
}

/** Approximate one physical-wind flow direction as a stable VISUAL speed
 * in Web Mercator screen pixels. Geographic latitude has 1/cos stretching,
 * so its degree increment must be scaled by cos before projection.
 * longitude has no extra Mercator scale and must NOT get an additional
 * 1/cos boost. Wind direction is applied by the caller using real U/V. */
export function windScreenStepDegrees(
  lat: number, zoom: number, pxPerSec: number, dt: number,
): { latitude: number; longitude: number } {
  const cos = Math.max(0.22, Math.cos(lat * Math.PI / 180));
  const pixelsPerEquatorialDegree = (256 * 2 ** zoom) / 360;
  const longitude = pxPerSec * dt / Math.max(8, pixelsPerEquatorialDegree);
  return { latitude: longitude * cos, longitude };
}

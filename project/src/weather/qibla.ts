/** Great-circle initial bearing to the Kaaba, degrees clockwise from geographic north. */
const KAABA_LAT = 21.4224779;
const KAABA_LON = 39.8251832;
const RAD = Math.PI / 180;

export function qiblaBearing(lat: number, lon: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const a = lat * RAD;
  const b = KAABA_LAT * RAD;
  const d = (KAABA_LON - lon) * RAD;
  const y = Math.sin(d) * Math.cos(b);
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d);
  // At the Kaaba or its antipode an initial bearing cannot be defined.
  if (Math.hypot(x, y) < 1e-12) return null;
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

/** Works only when the device heading is referenced to true geographic north. */
export function relativeQiblaDirection(bearing: number, trueHeading: number): number {
  return ((bearing - trueHeading) % 360 + 360) % 360;
}

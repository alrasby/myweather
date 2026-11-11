/** Initial great-circle bearing to the Kaaba, measured clockwise from
 * geographic true north. Device heading quality/calibration is independent. */
export const KAABA_LAT = 21.422487;
export const KAABA_LON = 39.826206;

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function qiblaBearing(latitude: number, longitude: number): number | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const r = Math.PI / 180;
  const a = latitude * r;
  const b = KAABA_LAT * r;
  const delta = (KAABA_LON - longitude) * r;
  const y = Math.sin(delta) * Math.cos(b);
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return normalizeBearing(Math.atan2(y, x) / r);
}

/** Needle direction relative to the top of the screen, assuming heading
 * is a calibrated TRUE-north heading. Magnetic north without declination
 * correction is not sufficient for guaranteed real-world accuracy. */
export function relativeQiblaAngle(qibla: number, heading: number): number {
  return normalizeBearing(qibla - heading);
}

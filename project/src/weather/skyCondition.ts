/** Reconcile only dry sky categories with co-timed cloud evidence.
 * Conservative: never erase a provider's clouds, precipitation, fog or storm.
 * These broad display bands are not a claim of observed local sky conditions.
 */
export function reconcileSkyCode(code: number, cloudCover: unknown): number {
  if (![0, 1, 2, 3].includes(code) || typeof cloudCover !== "number"
      || !Number.isFinite(cloudCover) || cloudCover < 0 || cloudCover > 100) return code;
  const cloudCode = cloudCover < 10 ? 0 : cloudCover < 35 ? 1 : cloudCover < 85 ? 2 : 3;
  return Math.max(code, cloudCode);
}

import type { MarineSnap } from "./types.ts";

/** Marine observations are independent of the land weather source.
 * Preserve a known coastal city's status across transient marine API
 * failures and MET.no fallback, without inventing wave measurements. */
export function preserveCoastalMarine(
  fresh: MarineSnap | null,
  previous: MarineSnap | null,
): MarineSnap | null {
  if (fresh?.coastal && fresh.wave != null && Number.isFinite(fresh.wave)) return fresh;
  if (previous?.coastal) return { coastal: true, wave: null };
  return fresh;
}

export function shouldDisplayTideCard(marine: MarineSnap | null): boolean {
  return marine?.coastal === true;
}

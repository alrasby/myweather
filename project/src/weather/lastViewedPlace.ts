import type { Place } from "./types.ts";

/** Persist the last *viewed* location, including unsaved search/GPS previews.
 * This is independent from the user's list of saved cities and their primary.
 */
export const LAST_VIEWED_KEY = "myweather-last-viewed-place-v1";

function validPlace(p: unknown): p is Place {
  if (!p || typeof p !== "object") return false;
  const x = p as Partial<Place>;
  return typeof x.id === "string" && x.id.length > 0 && x.id.length < 160
    && typeof x.name === "string" && x.name.length > 0 && x.name.length < 200
    && typeof x.lat === "number" && Number.isFinite(x.lat) && Math.abs(x.lat) <= 90
    && typeof x.lon === "number" && Number.isFinite(x.lon) && Math.abs(x.lon) <= 180;
}

export function readLastViewed(): Place | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_VIEWED_KEY) || "null");
    return validPlace(parsed) ? parsed : null;
  } catch { return null; }
}

export function saveLastViewed(place: Place | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (place) localStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(place));
    else localStorage.removeItem(LAST_VIEWED_KEY);
  } catch { /* storage restrictions are nonfatal */ }
}

export function restoreViewedPlace(
  stored: Place | null, saved: readonly Place[], fallbackId: string,
): { activeId: string; peek: Place | null } {
  if (!stored || !validPlace(stored)) return { activeId: fallbackId, peek: null };
  const match = saved.find(p => p.id === stored.id ||
    (Math.abs(p.lat - stored.lat) < 0.001 && Math.abs(p.lon - stored.lon) < 0.001));
  return match
    ? { activeId: match.id, peek: null }
    : { activeId: stored.id, peek: { ...stored, primary: false } };
}

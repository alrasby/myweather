import type { Place } from "./types";
import { MUSCAT } from "./types.ts";

export const LONDON: Place = {
  id: "51.51,-0.13", name: "لندن", nameEn: "London",
  country: "المملكة المتحدة", countryEn: "United Kingdom", admin: "England",
  lat: 51.507, lon: -0.128, primary: false,
};
export const NEW_YORK: Place = {
  id: "40.71,-74.01", name: "نيويورك", nameEn: "New York",
  country: "الولايات المتحدة", countryEn: "United States", admin: "New York",
  lat: 40.713, lon: -74.006, primary: false,
};
export const BEIJING: Place = {
  id: "39.90,116.41", name: "بكين", nameEn: "Beijing",
  country: "الصين", countryEn: "China", admin: "Beijing",
  lat: 39.904, lon: 116.407, primary: false,
};
export const INITIAL_CITIES: Place[] = [MUSCAT, LONDON, NEW_YORK, BEIJING];

function isKhoud(p: Place): boolean {
  return /الخوض|al[ -]?khoud|al[ -]?khod|al[ -]?khawd/i.test(p.name + " " + (p.nameEn ?? ""))
    && Math.abs(p.lat - 23.62) < 0.25 && Math.abs(p.lon - 58.18) < 0.35;
}
function isPrague(p: Place): boolean {
  return (/براغ|prague/i.test(p.name + " " + (p.nameEn ?? "")))
    && Math.abs(p.lat - 50.075) < 0.2 && Math.abs(p.lon - 14.44) < 0.2;
}
function sameCity(a: Place, b: Place): boolean {
  return a.id === b.id ||
    (Math.abs(a.lat - b.lat) < 0.04 && Math.abs(a.lon - b.lon) < 0.04);
}

/** One-time upgrade of the default sample cities, never a reset of user cities. */
export function upgradeInitialCities(
  saved: readonly Place[], activeId: string,
): { places: Place[]; activeId: string; changed: boolean } {
  if (!saved.length) return { places: INITIAL_CITIES.map((p) => ({ ...p })), activeId: MUSCAT.id, changed: true };
  // Never overwrite a real user's saved city merely because it is named
  // Prague or Al Khoud. Only migrate the recognizable original starter set.
  const oldStarter = saved.filter(p => p.primary).length === 1
    && saved[0]?.primary === true && isKhoud(saved[0])
    && saved.some(isPrague)
    && saved.some(p => sameCity(p, NEW_YORK))
    && saved.some(p => sameCity(p, BEIJING));
  if (!oldStarter) return { places: saved.slice(), activeId, changed: false };
  const upgraded = saved.map(p => isKhoud(p) ? { ...MUSCAT } : isPrague(p) ? { ...LONDON } : { ...p });
  const dedup: Place[] = [];
  for (const p of upgraded) if (!dedup.some(item => sameCity(item, p))) dedup.push(p);
  const muscat = dedup.find(p => sameCity(p, MUSCAT));
  if (!muscat) return { places: saved.slice(), activeId, changed: false };
  const places = [muscat, ...dedup.filter(p => p !== muscat)].map((p, i) => ({ ...p, primary: i === 0 }));
  const selected = saved.find(p => p.id === activeId);
  const mappedActive = selected
    ? isKhoud(selected) ? MUSCAT.id : isPrague(selected) ? LONDON.id : activeId
    : activeId;
  return { places, activeId: mappedActive, changed: true };
}

import { Check, ChevronDown, ChevronLeft, ChevronUp, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { searchPlaces } from "@/weather/api";
import { searchLocal } from "@/weather/places-index";
import { placeCountry, placeTitle } from "@/weather/format";
import { t } from "@/weather/i18n";
import { textBase } from "@/weather/locale";
import { useWeather } from "@/weather/store";
import type { Lang, Place } from "@/weather/types";

export function CitiesScreen({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const places = useWeather((s) => s.places);
  const activeId = useWeather((s) => s.activeId);
  const addPlace = useWeather((s) => s.addPlace);
  const viewPlace = useWeather((s) => s.viewPlace);
  const removePlace = useWeather((s) => s.removePlace);
  const movePlace = useWeather((s) => s.movePlace);
  const makePrimary = useWeather((s) => s.makePrimary);
  const setActive = useWeather((s) => s.setActive);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Place[]>([]);
  const [settled, setSettled] = useState(false);
  const kept = (hit: Place) =>
    places.some((p) => p.id === hit.id || (Math.abs(p.lat - hit.lat) < 0.02 && Math.abs(p.lon - hit.lon) < 0.02));

  const base = textBase();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSettled(false);
      return;
    }
    const ac = new AbortController();
    const local = searchLocal(q);
    setHits(local);
    setSettled(false);
    let ignore = false;
    let killer = 0;
    const timer = window.setTimeout(() => {
      killer = window.setTimeout(() => {
        ignore = true;
        ac.abort();
        setHits(local);
        setSettled(true);
      }, 4000);
      void searchPlaces(q, base, ac.signal)
        .then((rows) => {
          if (ignore) return;
          setHits(rows.length ? rows : local);
          setSettled(true);
        })
        .catch(() => {
          if (ignore) return;
          setHits(local);
          setSettled(true);
        })
        .finally(() => window.clearTimeout(killer));
    }, 100);
    return () => {
      ignore = true;
      ac.abort();
      window.clearTimeout(timer);
      window.clearTimeout(killer);
    };
  }, [query, base]);

  return (
    <div className="h-full overflow-y-auto px-3 pb-[calc(2.9rem+max(0.65rem,env(safe-area-inset-bottom))+2mm+6px)] pt-3">
      <header className="glass-bar sticky top-3 z-20 mb-4 flex items-center gap-2 rounded-full p-1.5">
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-full" aria-label={t(lang, "back")}>
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{t(lang, "cities")}</h1>
      </header>
      <label className="mt-4 block">
        <span className="sr-only">{t(lang, "searchPh")}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(lang, "searchPh")}
          className="h-12 w-full rounded-full border border-line bg-surface-solid/65 px-4 text-on-sky outline-none placeholder:text-on-sky/60"
        />
      </label>
      {query.trim().length >= 2 ? (
        <section className="mt-3">
          <p className="mb-1.5 px-2 text-[0.72rem] font-medium text-muted">{t(lang, "searchResults")}</p>
          <ul className="wx-card divide-y divide-line">
          {settled && hits.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">{t(lang, "noResults")}</li>
          ) : (
            hits.map((hit) => {
              const saved = kept(hit);
              return (
              <li key={hit.id} className="flex items-center gap-3 px-3 py-2">
                <button type="button" className="min-w-0 flex-1 py-2 text-start" onClick={() => { /* Preview only: saving requires the separate + button. */ viewPlace(hit); setQuery(""); onClose(); }}>
                  <p className="truncate text-sm text-fg">{placeTitle(hit, lang)}</p>
                  <p className="truncate text-xs text-muted">{[hit.admin, placeCountry(hit, lang)].filter(Boolean).join(" · ")}</p>
                </button>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center text-accent disabled:opacity-80"
                  aria-label={saved ? t(lang, "saved") : t(lang, "save")}
                  disabled={saved}
                  onClick={() => addPlace(hit, null, { activate: false })}
                >
                  {saved ? <Check className="size-4" /> : <Plus className="size-4" />}
                </button>
              </li>
              );
            })
          )}
          </ul>
        </section>
      ) : null}

      <p className="mb-1.5 mt-4 px-2 text-[0.72rem] font-medium text-muted">{t(lang, "savedCities")}</p>
      <ul className="space-y-2">
        {places.map((place, index) => {
          const on = place.id === activeId;
          return (
            <li key={place.id} className="wx-card flex items-center gap-2 px-3 py-2">
              <button type="button" className="min-w-0 flex-1 py-2 text-start" onClick={() => { setActive(place.id); onClose(); }}>
                <p className={`truncate text-sm ${on ? "text-accent" : "text-fg"}`}>{placeTitle(place, lang)}</p>
                <p className="truncate text-xs text-muted">
                  {place.primary ? `${t(lang, "primary")} · ` : ""}
                  {placeCountry(place, lang)}
                </p>
              </button>
              <button type="button" className="flex h-11 w-11 items-center justify-center text-muted" aria-label={t(lang, "up")} disabled={index === 0} onClick={() => movePlace(place.id, -1)}>
                <ChevronUp className="size-4" />
              </button>
              <button type="button" className="flex h-11 w-11 items-center justify-center text-muted" aria-label={t(lang, "down")} disabled={index === places.length - 1} onClick={() => movePlace(place.id, 1)}>
                <ChevronDown className="size-4" />
              </button>
              <button type="button" className="flex h-11 w-11 items-center justify-center text-accent" aria-label={t(lang, "makePrimary")} onClick={() => makePrimary(place.id)}>
                <Star className={`size-4 ${place.primary ? "fill-accent" : ""}`} />
              </button>
              <button type="button" className="flex h-11 w-11 items-center justify-center text-muted" aria-label={t(lang, "delete")} onClick={() => removePlace(place.id)}>
                <Trash2 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

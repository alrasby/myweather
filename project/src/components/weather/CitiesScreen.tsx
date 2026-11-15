import { Check, ChevronDown, ChevronLeft, ChevronUp, Plus, Search, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { searchPlaces } from "@/weather/api";
import { searchLocal } from "@/weather/places-index";
import { parseCoordinatePlace } from "@/weather/coordinateSearch";
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
  const [remote, setRemote] = useState<{query:string;hits:Place[];settled:boolean}>({query:"",hits:[],settled:false});
  const q=query.trim();
  const local=useMemo(()=>{const coords=parseCoordinatePlace(q);return coords?[coords]:searchLocal(q);},[q]);
  // Render the matching query only: React effects run after paint, so stale
  // rows from a just-completed old request must never flash under new input.
  const hits=remote.query===q?remote.hits:local;
  const settled=remote.query===q&&remote.settled;
  const hasTerm=Array.from(q).length>=2;
  const kept = (hit: Place) =>
    places.some((p) => p.id === hit.id || (Math.abs(p.lat - hit.lat) < 0.02 && Math.abs(p.lon - hit.lon) < 0.02));

  const base = textBase();

  useEffect(() => {
    if (Array.from(q).length < 2) {
      setRemote({query:q,hits:[],settled:false});
      return;
    }
    const ac = new AbortController();
    let current = true;
    setRemote({query:q,hits:local,settled:false});
    // Local results are synchronous; a short throttle protects the provider
    // while retaining responsive 2-character search on every keypress.
    const delay=window.setTimeout(()=>{
      const timeout=window.setTimeout(()=>{
        ac.abort();
        if(current)setRemote(v=>v.query===q?{...v,settled:true}:v);
      },3600);
      void searchPlaces(q,base,ac.signal,rows=>{
        if(current&&!ac.signal.aborted)setRemote({query:q,hits:rows,settled:false});
      }).then(rows=>{
        if(current&&!ac.signal.aborted)setRemote({query:q,hits:rows,settled:true});
      }).catch(()=>{
        if(current)setRemote(v=>v.query===q?{...v,settled:true}:v);
      }).finally(()=>window.clearTimeout(timeout));
    },90);
    return ()=>{current=false;window.clearTimeout(delay);ac.abort();};
  },[q,base,local]);

  return (
    <div className="wx-city-screen h-full overflow-y-auto px-3 pb-[calc(2.9rem+max(0.65rem,env(safe-area-inset-bottom))+2mm+6px)] pt-3">
      <header className="glass-bar sticky top-3 z-20 mb-4 flex items-center gap-2 rounded-full p-1.5">
        <button type="button" onClick={onClose} className="grid size-12 place-items-center rounded-full" aria-label={t(lang, "back")}>
          <ChevronLeft className="size-5 rtl:rotate-180" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{t(lang, "cities")}</h1>
      </header>
      <div className="wx-city-search-wrap mt-2">
        <Search aria-hidden="true" className="pointer-events-none absolute start-4 top-3.5 size-5 text-muted" />
        <label className="block">
          <span className="sr-only">{t(lang, "searchPh")}</span>
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-controls="wx-city-search-results"
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, "searchPh")}
            className="wx-search-field h-12 w-full rounded-2xl ps-12 pe-12 text-sm outline-none"
          />
        </label>
        {query ? (
          <button type="button" onClick={() => setQuery("")}
            className="absolute end-0 top-0 grid h-12 w-12 place-items-center rounded-xl text-muted"
            aria-label={t(lang, "clearCache") === "Clear cache" ? "Clear search" : lang === "ar" ? "مسح البحث" : "Clear search"}>
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      {hasTerm ? (
        <section className="mt-2.5" role="region" aria-label={t(lang, "searchResults")}>
          <div className="mb-1.5 flex items-center justify-between gap-2 px-2">
            <p className="text-[0.75rem] font-semibold text-on-sky">{t(lang, "searchResults")}</p>
            <span className="text-[0.69rem] text-on-sky/80" aria-live="polite">
              {hits.length > 0 ? (lang === "ar" ? `${hits.length} نتائج` : `${hits.length} results`) :
                settled ? "" : lang === "ar" ? "جار البحث…" : "Searching…"}
            </span>
          </div>
          <ul id="wx-city-search-results" aria-busy={!settled && hits.length === 0}
            className="wx-card wx-city-results overflow-hidden">
            {hits.length > 0 ? hits.map((hit) => {
              const saved=kept(hit);
              return (
                <li key={hit.id} className="wx-city-result-row wx-city-row flex items-center gap-3 px-3 py-1.5">
                  <button type="button" className="min-w-0 flex-1 py-2 text-start"
                    onClick={() => { viewPlace(hit); setQuery(""); onClose(); }}>
                    <p className="truncate text-sm font-semibold text-fg">{placeTitle(hit, lang)}</p>
                    <p className="truncate text-xs text-muted">{[hit.admin, placeCountry(hit, lang)].filter(Boolean).join(" · ")}</p>
                  </button>
                  <button type="button"
                    className="wx-city-action flex h-12 w-12 shrink-0 items-center justify-center text-accent disabled:opacity-75"
                    aria-label={saved ? t(lang, "saved") : t(lang, "save")}
                    disabled={saved} onClick={() => addPlace(hit, null, {activate:false})}>
                    {saved ? <Check className="size-4"/> : <Plus className="size-4"/>}
                  </button>
                </li>
              );
            }) : (
              <li role="status" className="px-4 py-4 text-center text-sm text-muted">
                {settled ? t(lang, "noResults") : lang === "ar" ? "جار البحث عن المدينة…" : "Searching for the city…"}
              </li>
            )}
          </ul>
        </section>
      ) : q ? (
        <p className="px-2 py-2 text-xs text-on-sky/85" role="status">
          {lang === "ar" ? "اكتب حرفًا إضافيًا لبدء البحث" : "Type one more letter to start"}
        </p>
      ) : null}
      {!hasTerm ? (
        <>
          <p className="mb-1.5 mt-3 px-2 text-[0.72rem] font-medium text-on-sky/85">{t(lang, "savedCities")}</p>
      <ul className="space-y-2">
        {places.map((place, index) => {
          const on = place.id === activeId;
          return (
            <li key={place.id} className="wx-card wx-city-row flex items-center gap-2 px-2 py-2">
              <button type="button" className="min-w-0 flex-1 py-2 text-start" onClick={() => { setActive(place.id); onClose(); }}>
                <p className={`truncate text-sm ${on ? "text-accent" : "text-fg"}`}>{placeTitle(place, lang)}</p>
                <p className="truncate text-xs text-muted">
                  {place.primary ? `${t(lang, "primary")} · ` : ""}
                  {placeCountry(place, lang)}
                </p>
              </button>
              <button type="button" className="wx-city-action flex h-12 w-12 shrink-0 items-center justify-center text-muted" aria-label={t(lang, "up")} disabled={index === 0} onClick={() => movePlace(place.id, -1)}>
                <ChevronUp className="size-4" />
              </button>
              <button type="button" className="wx-city-action flex h-12 w-12 shrink-0 items-center justify-center text-muted" aria-label={t(lang, "down")} disabled={index === places.length - 1} onClick={() => movePlace(place.id, 1)}>
                <ChevronDown className="size-4" />
              </button>
              <button type="button" className="wx-city-action flex h-12 w-12 shrink-0 items-center justify-center text-accent" aria-label={t(lang, "makePrimary")} onClick={() => makePrimary(place.id)}>
                <Star className={`size-4 ${place.primary ? "fill-accent" : ""}`} />
              </button>
              <button type="button" className="wx-city-action flex h-12 w-12 shrink-0 items-center justify-center text-muted" aria-label={t(lang, "delete")} onClick={() => removePlace(place.id)}>
                <Trash2 className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
        </>
      ) : null}
    </div>
  );
}

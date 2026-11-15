import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const css=read("src/styles.css");
const design=css.slice(css.indexOf("/* Calm Material-3-inspired"));
const home=read("src/components/weather/HomeScreen.tsx");
const app=read("src/components/weather/WeatherApp.tsx");
const cities=read("src/components/weather/CitiesScreen.tsx");
const settings=read("src/components/weather/SettingsScreen.tsx");
const map=read("src/components/weather/MapScreen.tsx");
const i18n=read("src/weather/i18n.ts");
const weather=read("src/weather/api.ts");
const format=read("src/weather/format.ts");
const comparison=read("src/weather/forecastSourceComparison.ts");
function role(name) {
  const match=[...design.matchAll(new RegExp("--"+name+":\\s*(#[0-9a-fA-F]{6})","g"))];
  assert.ok(match.length>=2,"expected day/night M3 paired role "+name);
  return match.map(x=>x[1]);
}
function luminance(hex){
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const [r,g,b]=rgb.map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
  return 0.2126*r+0.7152*g+0.0722*b;
}
function contrast(a,b){
  const [x,y]=[luminance(a),luminance(b)].sort((a,b)=>b-a);
  return (x+0.05)/(y+0.05);
}
test("paired light/dark card and search text surpass WCAG 2.2 AA 4.5:1",()=>{
 for(const [foreground,background] of [
  ["wx-card-text","wx-card-base"],
  ["wx-card-secondary","wx-card-base"],
  ["wx-search-text","wx-search-surface"],
 ]){
   const f=role(foreground),bg=role(background);
   for(let i=0;i<2;i++)assert.ok(contrast(f[i],bg[i])>=4.5,
     foreground+" / "+background+" ("+(i===0?"day":"night")+") "+
     contrast(f[i],bg[i]).toFixed(2));
 }
});
test("mobile glass keeps small-radius static blur and never modifies map tile raster",()=>{
 assert.ok(design.includes(".glass-bar") && design.includes(".wx-card"));
 const values=[...design.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g)]
   .map(m=>Number(m[1]));
 assert.ok(values.length>=2 && values.every(n=>n<=16),"heavy blur harms low-end Android");
 assert.ok(!design.includes("@keyframes") && !design.includes("background-attachment: fixed"));
 assert.ok(!design.includes(".leaflet-tile") && !design.includes(".wx-field"));
});
test("48px mobile touch targets, keyboard focus, contrast and reduced motion are guarded",()=>{
 assert.ok(app.includes("wx-bottom-nav")&&app.includes("min-h-12")&&app.includes('aria-current={tab === id ? "page"'));
 assert.ok(app.includes('aria-label={lang === "ar" ? "التنقل الرئيسي"'));
 assert.ok(cities.includes("wx-city-action")&&cities.includes("h-12 w-12"));
 assert.ok(cities.includes('type="search"')&&cities.includes('aria-controls="wx-city-search-results"'));
 assert.ok(settings.includes("min-h-12 w-full")&&settings.includes('role="switch"'));
 assert.ok(settings.includes("translate-x-7 rtl:-translate-x-7"));
 assert.ok(design.includes(":focus-visible") && design.includes("prefers-reduced-motion") &&
   design.includes("prefers-contrast: more") && design.includes("forced-colors: active"));
 assert.ok(design.includes("max-width: 360px"));
});
test("Arabic and English, city actions, forecast panels and stored settings retain behavior",()=>{
 assert.ok(app.includes("root.dir = ui.dir") && app.includes("root.lang = ui.tag"));
 for(const v of ["HourRibbon","DetailCards","QiblaCard","formatDayLabel","formatTemp"])assert.ok(home.includes(v));
 for(const v of ["addPlace(hit","removePlace(place.id)","movePlace(place.id","searchPlaces(q","searchLocal(q"])assert.ok(cities.includes(v));
 for(const v of ["setPrefs({ temp","setPrefs({ wind","setPrefs({ theme","setPrefs({ mapLayer","clearCache()"])assert.ok(settings.includes(v));
});
test("units, model valid-time, calendar timezone and two distinct forecast sources are not conflated",()=>{
 for(const v of ["unit === \"f\"","kmh / 3.6","0.621371","33.8638866667","timeZone,","hourCycle: \"h23\""])assert.ok(format.includes(v),v);
 assert.ok(weather.includes('url.searchParams.set("models", "best_match")'));
 assert.ok(weather.includes('bundle.forecastSource = "open-meteo-best-match"'));
 assert.ok(weather.includes('forecastSource: "met-no"'));
 assert.ok(comparison.includes("sameForecastHour"));
 assert.ok(map.includes("mapClockStatus"));
});
test("attribution is visible, linked and includes the real ECMWF layer and MET Norway fallback",()=>{
 assert.ok(map.includes("wx-map-source-credit")&&map.includes("https://www.esri.com/"));
 assert.ok(map.includes("open-meteo.com/en/license"));
 assert.ok(settings.includes("https://docs.api.met.no/doc/License.html"));
 assert.ok(settings.includes("https://creativecommons.org/licenses/by/4.0/"));
 assert.ok(i18n.includes("MET Norway") && i18n.includes("ECMWF"));
 assert.ok(i18n.includes("non-commercial")&&i18n.includes("غير التجاري"));
 assert.ok(weather.includes("https://nabdhserv.net"));
});

import test from "node:test";
import assert from "node:assert/strict";
import {searchLocal} from "./places-index.ts";
import {cityKey,mergeCityResults,relaxedCityQuery} from "./placeSearchQuality.ts";
const mk=(name:string,lat:number,lon:number)=>({
 name,nameEn:name,country:"Oman",countryEn:"Oman",admin:"",lat,lon,
 id:lat+","+lon,primary:false,
});
test("2 typed Arabic/English characters yield immediately available real local cities",()=>{
 assert.ok(searchLocal("مس").some(p=>p.name==="مسقط"));
 assert.ok(searchLocal("Mu").some(p=>p.nameEn==="Muscat"));
 assert.ok(searchLocal("هِلْ").some(p=>p.name==="هلسنكي")||searchLocal("هل").some(p=>p.name==="هلسنكي"));
});
test("full Arabic name, extra diacritics and Latin accents have stable matching",()=>{
 assert.equal(cityKey("  مَسْقَط "),cityKey("مسقط"));
 assert.equal(cityKey("São   Paulo"),"saopaulo");
 assert.equal(cityKey("أبو ظبي"),cityKey("ابو ظبي"));
 assert.equal(mergeCityResults("مسقط",searchLocal("مسقط"),[])[0]?.name,"مسقط");
});
test("prefix fallback repairs a one-character full-name mismatch but never guesses for two characters",()=>{
 assert.equal(relaxedCityQuery("مسقطت"),"مسقط");
 assert.equal(relaxedCityQuery("Helsinkii"),"Helsinki");
 assert.equal(relaxedCityQuery("Paris, Fran"),"Paris");
 assert.equal(relaxedCityQuery("مس"),null);
});
test("merge prefers exact city and deduplicates geocoder/local coordinates",()=>{
 const near=mk("Muscat",23.589,58.39),other=mk("Muscat village",22,58);
 const result=mergeCityResults("Muscat",searchLocal("Muscat"),[near,other]);
 assert.equal(result.filter(p=>Math.abs(p.lat-23.588)<0.02).length,1);
 assert.equal(result[0]?.nameEn,"Muscat");
 assert.ok(result.some(p=>p.lat===22));
});
test("empty and invalid geocoding coordinates never appear or throw",()=>{
 const result=mergeCityResults("Do",[mk("Doha",25,51),mk("Invalid",Number.NaN,56)],[]);
 assert.deepEqual(result.map(p=>p.name),["Doha"]);
 assert.deepEqual(mergeCityResults("abc",[],[]),[]);
});

test("device regression: typing براغ must return Prague before any network request",()=>{
 for(const q of ["بر","برا","براغ","Pr","Prag","Prague"]){
  const hits=searchLocal(q);
  assert.ok(hits.some(p=>p.nameEn==="Prague"),q+" must have an offline candidate");
 }
 const results=mergeCityResults("براغ",searchLocal("براغ"),[]);
 assert.equal(results[0]?.nameEn,"Prague");
});

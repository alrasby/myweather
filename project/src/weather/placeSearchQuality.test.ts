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

test("complete Damascus/Dublin/Prague queries never lose their real bundled city",()=>{
 for(const [ar,en] of [["دمشق","Damascus"],["دبلن","Dublin"],["براغ","Prague"],["موسكو","Moscow"],["دبي","Dubai"]]){
   const local=searchLocal(ar);
   assert.ok(local.some(p=>p.nameEn===en),"no synchronous local match for "+ar);
   for(const stale of [[],[mk("Unrelated",1,1)],searchLocal("Paris")]){
     const all=mergeCityResults(ar,local,stale);
     assert.ok(all.some(p=>p.nameEn===en),"remote must not hide "+ar);
   }
 }
});
test("two-letter city search gives local prefix but never fabricates a worldwide result",()=>{
 assert.ok(searchLocal("دم").some(p=>p.nameEn==="Damascus"));
 assert.ok(searchLocal("دب").some(p=>p.nameEn==="Dubai"||p.nameEn==="Dublin"));
 assert.equal(mergeCityResults("zz",[],[]).length,0);
});

test("Al Kamil Wal Wafi official wilayat matches Arabic fragments and Latin forms",()=>{
 for(const term of ["الكامل","الكامل والوافي","الكامل و الوافي",
    "الوافي","ولاية الكامل والوافي","Al Kamil","Al Kamil Wal Wafi",
    "Al Kamil Wa Al Wafi"]){
   const rows=mergeCityResults(term,searchLocal(term),[]);
   assert.ok(rows.some(p=>p.name==="الكامل والوافي"&&p.country==="سلطنة عمان"),term);
   assert.ok(rows.some(p=>Math.abs(p.lat-22.2201)<.02&&Math.abs(p.lon-59.2001)<.02),term);
 }
});
test("unrelated remote city names cannot appear among Arabic city suggestions",()=>{
 const rows=mergeCityResults("طوك",searchLocal("طوك"),[mk("Khartoum",15.5,32.56),mk("Tokyo",35.68,139.7)]);
 assert.ok(rows.some(p=>p.nameEn==="Tokyo"));
 assert.ok(!rows.some(p=>p.name==="Khartoum"));
 assert.deepEqual(mergeCityResults("الكامل",[],[mk("Unrelated",1,1)]),[]);
});

test("device search regressions: Galway and country-qualified Brest",()=>{
 for(const [query,city] of [["غالواي","Galway"],["غَالْوَاي","Galway"],["بريست، فرنسا","Brest"],["Brest, France","Brest"],["نانت","Nantes"]]){
  const results=mergeCityResults(query,searchLocal(query),[]);
  assert.equal(results[0]?.nameEn,city,query);
  if(city==="Brest")assert.equal(results[0]?.countryEn,"France");
 }
 const belarus={...mk("بريست",52.1,23.7),nameEn:"Brest",country:"بيلاروس",countryEn:"Belarus"};
 assert.ok(!mergeCityResults("بريست، فرنسا",searchLocal("بريست"),[belarus]).includes(belarus));
});

import assert from "node:assert/strict";
import {test} from "node:test";
import {parseCoordinatePlace} from "./coordinateSearch.ts";

test("an arbitrary point on every continent or ocean can be searched without geocoder",()=>{
 const samples=[
  ["South Pacific",-17.5516,-149.5585],
  ["Svalbard",78.2232,15.6469],
  ["North Pole",90,0],
  ["South Pole",-90,0],
  ["date line east",0,180],
  ["date line west",0,-180],
  ["South Atlantic",-55.123456,-21.987654],
  ["Fiji",-18.1416,178.4419],
 ] as const;
 for(const [place,lat,lon] of samples){
  const result=parseCoordinatePlace(String(lat)+","+String(lon));
  assert.ok(result,place);
  assert.equal(result.lat,lat);
  assert.equal(result.lon,lon);
  assert.equal(result.primary,false);
  assert.ok(result.id.startsWith("wgs84:"));
 }
});
test("Arabic and Persian numeral locations are accepted even without a place name",()=>{
 const ar=parseCoordinatePlace("٢٣٫٥٨٨،٥٨٫٣٨٢٩");
 assert.deepEqual([ar?.lat,ar?.lon],[23.588,58.3829]);
 const fa=parseCoordinatePlace("−۱۷٫۵۵،−۱۴۹٫۵۶");
 assert.deepEqual([fa?.lat,fa?.lon],[-17.55,-149.56]);
});
test("malformed and outside-earth coordinates are rejected",()=>{
 for(const input of ["London","New York","90.001,0","0,180.0001","-91,0","0,-181",
  "NaN,12","Infinity,12","1.1.1,20","20,20,20","12 33","1e308,10","",","]){
  assert.equal(parseCoordinatePlace(input),null,input);
 }
});
test("precision distinguishes neighbouring points and never fabricates a country",()=>{
 const a=parseCoordinatePlace("0.000001,179.999999");
 const b=parseCoordinatePlace("0.000002,179.999999");
 assert.ok(a&&b);
 assert.notEqual(a.id,b.id);
 assert.equal(a.country,"");
 assert.equal(a.lat,0.000001);
});

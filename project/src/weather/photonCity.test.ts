import test from "node:test";
import assert from "node:assert/strict";
import {photonCities} from "./photonCity.ts";
test("OSM fallback excludes shops/bad coordinates and retains attribution",()=>{
 const input={features:[
 {properties:{osm_value:"city",name:"دمشق",country:"سوريا",osm_type:"N",osm_id:123},geometry:{coordinates:[36.3,33.5]}},
 {properties:{osm_value:"bakery",name:"shop"},geometry:{coordinates:[12,50]}},
 {properties:{osm_value:"town",name:"თბილისი"},geometry:{coordinates:[44.8,41.7]}},
 {properties:{osm_value:"city",name:"bad"},geometry:{coordinates:[200,40]}}
 ]};
 const items=photonCities(input);
 assert.deepEqual(items.map(x=>x.name),["دمشق","თბილისი"]);
 assert.equal(items[0]?.source,"osm-photon");
 assert.equal(items[0]?.id,"osm:N:123");
});
test("malformed provider replies cannot create false places",()=>{
 assert.deepEqual(photonCities(null),[]);
 assert.deepEqual(photonCities({features:"bad"}),[]);
});

test("GeoNames service results preserve real GeoNames IDs, coordinates and attribution",()=>{
 const out=photonCities({type:"FeatureCollection",features:[{
   type:"Feature",geometry:{type:"Point",coordinates:[36.3,33.5]},
   properties:{name:"دمشق",name_en:"Damascus",geonames_id:170654,osm_value:"city",source:"geonames",country:"SY"}
 }]});
 assert.equal(out[0]?.id,"geonames:170654");
 assert.equal(out[0]?.source,"geonames");
 assert.equal(out[0]?.name,"دمشق");
 assert.equal(out[0]?.nameEn,"Damascus");
 assert.equal(out[0]?.lon,36.3);
 assert.notEqual(out[0]?.source,"osm-photon");
});

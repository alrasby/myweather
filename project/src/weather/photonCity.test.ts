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

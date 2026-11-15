import test from "node:test";
import assert from "node:assert/strict";
import {privateGeocoderUrl,validatePrivateGeocoderEndpoint} from "./privateGeocoder.ts";
const OWN="https://geocode.nabdhserv.net/api";
test("production geocoder requires explicit credential-free HTTPS /api endpoint",()=>{
 assert.equal(validatePrivateGeocoderEndpoint(OWN),OWN);
 assert.equal(validatePrivateGeocoderEndpoint(OWN+"/"),OWN);
 for(const bad of [null,"","http://geo.example.org/api",
 "https://photon.komoot.io/api","https://localhost/api",
 "https://127.0.0.1/api","https://bad.internal/api",
 "https://alice:secret@geo.example.org/api",
 "https://geo.example.org/api?q=x","https://geo.example.org/api#frag",
 "https://geo.example.org/other"]){
   assert.equal(validatePrivateGeocoderEndpoint(bad),null,String(bad));
 }
});
test("production lookup only sends a bounded city prefix, never a credential",()=>{
 const u=new URL(privateGeocoderUrl(OWN,"  دمشق  ","ar"));
 assert.equal(u.origin,"https://geocode.nabdhserv.net");
 assert.equal(u.searchParams.get("q"),"دمشق");
 assert.equal(u.searchParams.get("lang"),"ar");
 assert.deepEqual(u.searchParams.getAll("layer"),["city","locality"]);
 assert.equal(u.searchParams.get("limit"),"6");
 assert.throws(()=>privateGeocoderUrl(OWN,"مس","ar"),/invalid-geocoder-request/);
});

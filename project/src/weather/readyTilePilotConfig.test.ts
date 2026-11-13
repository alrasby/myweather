import assert from "node:assert/strict";
import {test} from "node:test";
import {readReadyTilePilotOrigin,pilotManifestIsUsable,READY_TILES_PILOT_ENABLED,READY_TILES_PILOT_ORIGIN} from "./readyTilePilotConfig.ts";
function store(on:string,uri:string){
 const values=new Map([[READY_TILES_PILOT_ENABLED,on],[READY_TILES_PILOT_ORIGIN,uri]]);
 return {getItem:(key:string)=>values.get(key)??null};
}
test("pilot must be explicitly enabled with safe HTTPS origin",()=>{
 assert.equal(readReadyTilePilotOrigin(store("0","https://tiles.example.org")),null);
 assert.equal(readReadyTilePilotOrigin(store("1","https://tiles.example.org/")),"https://tiles.example.org");
 assert.equal(readReadyTilePilotOrigin(store("1","http://tiles.example.org")),null);
 assert.equal(readReadyTilePilotOrigin(store("1","http://127.0.0.1:8788")),null);
 assert.equal(readReadyTilePilotOrigin(store("1","https://user:pass@tiles.example.org")),null);
 assert.equal(readReadyTilePilotOrigin(store("1","https://tiles.example.org/?secret=1")),null);
 assert.equal(readReadyTilePilotOrigin({getItem:()=>{throw new Error("private mode");}}),null);
});
test("pilot rejects expired or far-future run but accepts bounded valid UTC period",()=>{
 const now=Date.parse("2026-11-13T10:00:00Z");
 assert.equal(pilotManifestIsUsable({referenceTime:"2026-11-13T06:00:00Z",validTimes:["2026-11-13T06:00:00Z","2026-11-14T00:00:00Z"]},now),true);
 assert.equal(pilotManifestIsUsable({referenceTime:"2026-11-01T06:00:00Z",validTimes:["2026-11-01T06:00:00Z"]},now),false);
 assert.equal(pilotManifestIsUsable({referenceTime:"2026-11-14T06:00:00Z",validTimes:["2026-11-14T06:00:00Z"]},now),false);
});

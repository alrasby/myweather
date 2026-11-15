import test from "node:test";
import assert from "node:assert/strict";
import {queryLanguage,nonLatinCityQuery} from "./searchScript.ts";
test("Arabic/Persian/Urdu geocoding uses typed script, not English",()=>{
 assert.equal(queryLanguage("دمشق","en"),"ar");
 assert.equal(queryLanguage("اصفهان","fa"),"fa");
 assert.equal(queryLanguage("لاہور","ur"),"ur");
 assert.equal(nonLatinCityQuery("براغ"),true);
});
test("Russian, Ukrainian, Japanese, Korean, Chinese, Greek and Hebrew scripts",()=>{
 const cases=[["Москва","en","ru"],["Київ","en","uk"],
 ["서울","en","ko"],["上海","en","zh"],["大阪","ja","ja"],["Αθήνα","en","el"],
 ["ירושלים","en","he"],["मुंबई","en","hi"]] as const;
 for(const [q,base,expected] of cases)assert.equal(queryLanguage(q,base),expected,q);
});
test("Latin script respects chosen language; no unnecessary native fallback",()=>{
 assert.equal(queryLanguage("München","de"),"de");
 assert.equal(queryLanguage("Paris","fr"),"fr");
 assert.equal(queryLanguage("London","en"),"en");
 assert.equal(nonLatinCityQuery("Prague"),false);
});

test("Han-only names cannot be intrinsically classified as Chinese or Japanese",()=>{
 assert.equal(queryLanguage("大阪","en"),"zh");
 assert.equal(queryLanguage("大阪","ja"),"ja");
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {validPng} from "./pngIntegrity.mjs";
import {makeTestPng} from "./testPng.mjs";
test("raster guard accepts a complete 256x256 RGBA PNG and rejects corrupt/weather-fake files",()=>{
 const valid=makeTestPng();
 assert.equal(validPng(valid),true);
 const fake=Buffer.concat([valid.subarray(0,8),Buffer.alloc(40)]);
 assert.equal(validPng(fake),false);
 assert.equal(validPng(Buffer.from("<html>429 rate limited</html>")),false);
 const crc=Buffer.from(valid);crc[35]^=1;
 assert.equal(validPng(crc),false);
 const truncated=valid.subarray(0,valid.length-12);
 assert.equal(validPng(truncated),false);
 const garbage=Buffer.concat([valid,Buffer.from("bad")]);
 assert.equal(validPng(garbage),false);
});

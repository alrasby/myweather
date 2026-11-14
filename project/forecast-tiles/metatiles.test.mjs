import assert from "node:assert/strict";
import {test} from "node:test";
import {metaTileBounds} from "./metatiles.mjs";
import {tileBounds} from "./contracts.mjs";
test("a 4x4 metatile shares one decoded data window without crossing the dateline",()=>{
 const a=metaTileBounds({z:6,x:23,y:25});
 const b=metaTileBounds({z:6,x:20,y:24});
 assert.deepEqual(a,b);
 assert.notDeepEqual(a,metaTileBounds({z:6,x:24,y:25}));
 for(const cell of [{z:6,x:23,y:25},{z:6,x:20,y:24}]){
  const bounds=tileBounds(cell);
  assert.ok(a[0]<=bounds.west&&a[2]>=bounds.east&&a[1]<=bounds.south&&a[3]>=bounds.north);
 }
 const edge=metaTileBounds({z:8,x:255,y:100});
 assert.equal(edge[2],180);
 assert.throws(()=>metaTileBounds({z:8,x:256,y:100}));
});

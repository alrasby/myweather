import assert from "node:assert/strict";
import { test } from "node:test";
import {decideSpatialViewport,ECMWF_REGIONAL_MIN_ZOOM} from "./spatialViewportBudget.ts";
const view=(zoom:number,lonSpan:number,latSpan:number)=>({
 zoom,west:-15,east:-15+lonSpan,south:5,north:5+latSpan
});
test("real Android video zoom 3 and zoom 5 must never trigger huge ECMWF data reads",()=>{
 assert.deepEqual(decideSpatialViewport(view(3,63.3,108.4)),{allow:false,reason:"world-scale"});
 assert.deepEqual(decideSpatialViewport(view(5,15.8,25.4)),{allow:false,reason:"world-scale"});
 assert.equal(ECMWF_REGIONAL_MIN_ZOOM,6);
});
test("zoomed-in region retains all three genuine ECMWF fields",()=>{
 assert.deepEqual(decideSpatialViewport(view(6,8,12)),{allow:true,reason:"regional"});
 assert.deepEqual(decideSpatialViewport(view(9,2,4)),{allow:true,reason:"regional"});
});
test("a large physical viewport is blocked even with an anomalously high zoom value",()=>{
 assert.deepEqual(decideSpatialViewport(view(9,65,10)),{allow:false,reason:"longitude-band"});
 assert.deepEqual(decideSpatialViewport(view(9,4,28)),{allow:false,reason:"latitude-band"});
});
test("wrapped world copies and bad coordinates never request global .om data accidentally",()=>{
 assert.equal(decideSpatialViewport({zoom:8,west:165,east:-165,south:15,north:30}).allow,true);
 assert.equal(decideSpatialViewport({zoom:8,west:525,east:555,south:15,north:30}).allow,true);
 for(const v of [
   {zoom:8,west:0,east:360,south:-75,north:76},
   {zoom:9,west:NaN,east:20,south:5,north:20},
   {zoom:9,west:40,east:20,south:5,north:20},
   {zoom:10,west:0,east:10,south:30,north:20},
 ]) assert.equal(decideSpatialViewport(v).allow,false);
});
